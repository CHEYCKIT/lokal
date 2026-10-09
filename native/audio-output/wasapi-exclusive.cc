#include "wasapi-exclusive.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <condition_variable>
#include <cstring>
#include <limits>
#include <mutex>
#include <thread>
#include <vector>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <audioclient.h>
#include <avrt.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>

using Microsoft::WRL::ComPtr;

namespace {
constexpr uint64_t kRingCapacityFrames = 131072;
constexpr uint32_t kWriteFrames = 1024;
constexpr REFERENCE_TIME kReferenceTimesPerSecond = 10000000;
constexpr REFERENCE_TIME kMillisecond = 10000;

REFERENCE_TIME framesToReferenceTime(uint32_t frames, uint32_t sampleRate) {
  return static_cast<REFERENCE_TIME>(
    (static_cast<uint64_t>(frames) * kReferenceTimesPerSecond + sampleRate - 1) / sampleRate);
}

WAVEFORMATEX makeWaveFormat(uint32_t sampleRate, uint32_t bits) {
  WAVEFORMATEX format{};
  format.wFormatTag = bits == 32 ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM;
  format.nChannels = 2;
  format.nSamplesPerSec = sampleRate;
  format.wBitsPerSample = static_cast<WORD>(bits);
  format.nBlockAlign = static_cast<WORD>(format.nChannels * bits / 8);
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
  return format;
}
}

struct WasapiExclusiveOutput::Impl {
  mutable std::mutex mutex;
  std::condition_variable readyChanged;
  std::condition_variable startChanged;
  std::thread thread;
  HANDLE stopEvent = nullptr;
  HANDLE resetEvent = nullptr;
  HANDLE sampleEvent = nullptr;
  std::vector<uint8_t> ring;
  uint64_t ringCapacityFrames = kRingCapacityFrames;
  uint32_t bytesPerFrame = 0;
  uint32_t endpointBytesPerFrame = 0;
  uint32_t inputBits = 0;
  uint32_t endpointBits = 0;
  std::atomic<uint64_t> writtenFrames{0};
  std::atomic<uint64_t> readFrames{0};
  std::atomic<uint64_t> renderedFrames{0};
  std::atomic<uint64_t> underrunFrames{0};
  std::atomic<uint64_t> underrunEvents{0};
  std::atomic<uint64_t> discardTarget{0};
  std::atomic<uint64_t> discardGeneration{0};
  std::atomic<uint64_t> completedDiscardGeneration{0};
  std::atomic<uint64_t> discardedFrames{0};
  std::atomic<uint32_t> sampleRate{0};
  std::atomic<bool> opened{false};
  std::atomic<bool> running{false};
  bool ready = false;
  bool startRequested = false;
  bool startFinished = false;
  bool startSucceeded = false;
  bool stopRequested = false;
  std::string startupError;
  std::string startError;

  void signalReady(std::string error = {}) {
    std::lock_guard<std::mutex> lock(mutex);
    startupError = std::move(error);
    ready = true;
    opened.store(startupError.empty(), std::memory_order_release);
    readyChanged.notify_all();
  }

  void signalStart(bool success, std::string error = {}) {
    std::lock_guard<std::mutex> lock(mutex);
    startSucceeded = success;
    startError = std::move(error);
    startFinished = true;
    running.store(success, std::memory_order_release);
    startChanged.notify_all();
  }

  void applyPendingDiscard() {
    const uint64_t generation = discardGeneration.load(std::memory_order_acquire);
    const uint64_t completed = completedDiscardGeneration.load(std::memory_order_relaxed);
    if (generation == completed) return;

    const uint64_t target = discardTarget.load(std::memory_order_acquire);
    uint64_t read = readFrames.load(std::memory_order_relaxed);
    const uint64_t skipped = target > read ? target - read : 0;
    readFrames.store(std::max(read, target), std::memory_order_release);
    discardedFrames.fetch_add(skipped, std::memory_order_relaxed);
    completedDiscardGeneration.store(generation, std::memory_order_release);
  }

  void copyQueuedFrames(uint8_t* destination, uint32_t frames, std::vector<uint8_t>& sourceBuffer) {
    applyPendingDiscard();
    const uint64_t read = readFrames.load(std::memory_order_relaxed);
    const uint64_t written = writtenFrames.load(std::memory_order_acquire);
    const uint32_t available = static_cast<uint32_t>(std::min<uint64_t>(written - std::min(written, read), frames));
    const uint64_t offsetFrames = read % ringCapacityFrames;
    const uint32_t firstFrames = static_cast<uint32_t>(
      std::min<uint64_t>(available, ringCapacityFrames - offsetFrames));
    const size_t firstBytes = static_cast<size_t>(firstFrames) * bytesPerFrame;
    if (firstBytes) {
      std::memcpy(sourceBuffer.data(), ring.data() + offsetFrames * bytesPerFrame, firstBytes);
    }
    const uint32_t secondFrames = available - firstFrames;
    if (secondFrames) {
      std::memcpy(sourceBuffer.data() + firstBytes, ring.data(), static_cast<size_t>(secondFrames) * bytesPerFrame);
    }
    const size_t usedBytes = static_cast<size_t>(available) * bytesPerFrame;
    const size_t totalBytes = static_cast<size_t>(frames) * bytesPerFrame;
    if (available < frames) {
      underrunFrames.fetch_add(frames - available, std::memory_order_relaxed);
      underrunEvents.fetch_add(1, std::memory_order_relaxed);
    }
    if (usedBytes < totalBytes) std::memset(sourceBuffer.data() + usedBytes, 0, totalBytes - usedBytes);
    if (inputBits == endpointBits) {
      std::memcpy(destination, sourceBuffer.data(), static_cast<size_t>(frames) * endpointBytesPerFrame);
    } else if (inputBits == 32) {
      const float* input = reinterpret_cast<const float*>(sourceBuffer.data());
      int16_t* output = reinterpret_cast<int16_t*>(destination);
      const size_t samples = static_cast<size_t>(frames) * 2;
      for (size_t i = 0; i < samples; ++i) {
        const float sample = std::isfinite(input[i]) ? std::max(-1.0f, std::min(input[i], 1.0f)) : 0.0f;
        output[i] = sample <= -1.0f ? INT16_MIN
          : sample >= 1.0f ? INT16_MAX
          : static_cast<int16_t>(std::lrint(sample * INT16_MAX));
      }
    } else {
      const int16_t* input = reinterpret_cast<const int16_t*>(sourceBuffer.data());
      float* output = reinterpret_cast<float*>(destination);
      const size_t samples = static_cast<size_t>(frames) * 2;
      for (size_t i = 0; i < samples; ++i) output[i] = static_cast<float>(input[i]) / 32768.0f;
    }
    readFrames.store(read + available, std::memory_order_release);
  }

  void run(const std::wstring endpointId, uint32_t rate, uint32_t bits) {
    const HRESULT comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(comResult)) {
      signalReady("Could not initialize COM for WASAPI output.");
      return;
    }
    struct ComUninitializer {
      ~ComUninitializer() { CoUninitialize(); }
    } comUninitializer;

    ComPtr<IMMDeviceEnumerator> enumerator;
    HRESULT hr = CoCreateInstance(
      __uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
      IID_PPV_ARGS(enumerator.GetAddressOf()));
    ComPtr<IMMDevice> device;
    if (SUCCEEDED(hr)) hr = enumerator->GetDevice(endpointId.c_str(), device.GetAddressOf());
    if (FAILED(hr) || !device) {
      signalReady("The selected WASAPI output device is unavailable.");
      return;
    }

    const uint32_t candidateBits[] = { bits, bits == 32 ? 16u : 32u };
    WAVEFORMATEX plainFormats[2]{};
    WAVEFORMATEXTENSIBLE extensibleFormats[2]{};
    const WAVEFORMATEX* formats[4]{};
    for (size_t i = 0; i < 2; ++i) {
      plainFormats[i] = makeWaveFormat(rate, candidateBits[i]);
      extensibleFormats[i].Format = plainFormats[i];
      extensibleFormats[i].Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
      extensibleFormats[i].Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
      extensibleFormats[i].Samples.wValidBitsPerSample = static_cast<WORD>(candidateBits[i]);
      extensibleFormats[i].dwChannelMask = SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
      extensibleFormats[i].SubFormat = candidateBits[i] == 32
        ? KSDATAFORMAT_SUBTYPE_IEEE_FLOAT : KSDATAFORMAT_SUBTYPE_PCM;
      formats[i * 2] = &extensibleFormats[i].Format;
      formats[i * 2 + 1] = &plainFormats[i];
    }
    ComPtr<IAudioClient> client;
    REFERENCE_TIME defaultPeriod = 0, minimumPeriod = 0;
    hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
      reinterpret_cast<void**>(client.GetAddressOf()));
    if (SUCCEEDED(hr)) hr = client->GetDevicePeriod(&defaultPeriod, &minimumPeriod);
    if (FAILED(hr)) {
      signalReady("WASAPI could not query the device period.");
      return;
    }

    const REFERENCE_TIME stablePeriod = std::max<REFERENCE_TIME>(
      std::max(defaultPeriod, minimumPeriod), 5 * kMillisecond);
    REFERENCE_TIME periods[3]{};
    size_t periodCount = 0;
    for (REFERENCE_TIME period : { stablePeriod, defaultPeriod, minimumPeriod }) {
      if (period > 0 && std::find(periods, periods + periodCount, period) == periods + periodCount) {
        periods[periodCount++] = period;
      }
    }
    const DWORD flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_NOPERSIST;
    bool initialized = false;
    uint32_t actualBits = bits;
    for (size_t periodIndex = 0; periodIndex < periodCount; ++periodIndex) {
      for (size_t formatIndex = 0; formatIndex < 4; ++formatIndex) {
        const WAVEFORMATEX* format = formats[formatIndex];
        client.Reset();
        hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
          reinterpret_cast<void**>(client.GetAddressOf()));
        if (FAILED(hr)) continue;
        hr = client->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, flags,
          periods[periodIndex], periods[periodIndex], format, nullptr);
        if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
          UINT32 alignedFrames = 0;
          if (SUCCEEDED(client->GetBufferSize(&alignedFrames)) && alignedFrames > 0) {
            const REFERENCE_TIME alignedPeriod = framesToReferenceTime(alignedFrames, rate);
            client.Reset();
            hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
              reinterpret_cast<void**>(client.GetAddressOf()));
            if (SUCCEEDED(hr)) {
              hr = client->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, flags,
                alignedPeriod, alignedPeriod, format, nullptr);
            }
          }
        }
        if (SUCCEEDED(hr)) {
          initialized = true;
          actualBits = candidateBits[formatIndex / 2];
          break;
        }
      }
      if (initialized) break;
    }
    if (!initialized || !client) {
      signalReady("WASAPI rejected the requested exclusive format or buffer period.");
      return;
    }

    sampleEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!sampleEvent || FAILED(client->SetEventHandle(sampleEvent))) {
      signalReady("WASAPI could not register its render event.");
      if (sampleEvent) { CloseHandle(sampleEvent); sampleEvent = nullptr; }
      return;
    }

    UINT32 bufferFrames = 0;
    hr = client->GetBufferSize(&bufferFrames);
    ComPtr<IAudioRenderClient> renderClient;
    if (SUCCEEDED(hr)) {
      hr = client->GetService(__uuidof(IAudioRenderClient),
        reinterpret_cast<void**>(renderClient.GetAddressOf()));
    }
    if (FAILED(hr) || bufferFrames == 0 || !renderClient) {
      signalReady("WASAPI could not initialize the exclusive render buffer.");
      CloseHandle(sampleEvent);
      sampleEvent = nullptr;
      return;
    }

    endpointBits = actualBits;
    endpointBytesPerFrame = 2 * actualBits / 8;
    std::vector<uint8_t> sourceBuffer;
    try {
      sourceBuffer.resize(static_cast<size_t>(bufferFrames) * bytesPerFrame);
    } catch (const std::exception&) {
      signalReady("Could not allocate the WASAPI render buffer.");
      CloseHandle(sampleEvent);
      sampleEvent = nullptr;
      return;
    }

    BYTE* endpointBuffer = nullptr;
    hr = renderClient->GetBuffer(bufferFrames, &endpointBuffer);
    if (SUCCEEDED(hr) && endpointBuffer) {
      std::memset(endpointBuffer, 0, static_cast<size_t>(bufferFrames) * endpointBytesPerFrame);
      hr = renderClient->ReleaseBuffer(bufferFrames, 0);
    } else if (SUCCEEDED(hr)) {
      hr = E_POINTER;
    }
    if (FAILED(hr)) {
      signalReady("WASAPI could not prime the exclusive render buffer.");
      CloseHandle(sampleEvent);
      sampleEvent = nullptr;
      return;
    }

    sampleRate.store(rate, std::memory_order_release);
    signalReady();
    {
      std::unique_lock<std::mutex> lock(mutex);
      startChanged.wait(lock, [this]() { return startRequested || stopRequested; });
      if (stopRequested) {
        lock.unlock();
        client->Stop();
        client->Reset();
        CloseHandle(sampleEvent);
        sampleEvent = nullptr;
        return;
      }
    }

    DWORD taskIndex = 0;
    HANDLE mmcss = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);
    if (mmcss) AvSetMmThreadPriority(mmcss, AVRT_PRIORITY_HIGH);
    hr = client->Start();
    signalStart(SUCCEEDED(hr), SUCCEEDED(hr) ? std::string{} : "WASAPI could not start exclusive playback.");
    if (FAILED(hr)) {
      if (mmcss) AvRevertMmThreadCharacteristics(mmcss);
      CloseHandle(sampleEvent);
      sampleEvent = nullptr;
      return;
    }

    HANDLE waits[] = { stopEvent, resetEvent, sampleEvent };
    bool finished = false;
    while (!finished) {
      const DWORD result = WaitForMultipleObjects(3, waits, FALSE, 2000);
      if (result == WAIT_OBJECT_0) {
        finished = true;
      } else if (result == WAIT_OBJECT_0 + 1) {
        applyPendingDiscard();
        hr = client->Stop();
        if (SUCCEEDED(hr)) hr = client->Reset();
        if (SUCCEEDED(hr)) {
          hr = renderClient->GetBuffer(bufferFrames, &endpointBuffer);
          if (SUCCEEDED(hr) && endpointBuffer) {
            std::memset(endpointBuffer, 0, static_cast<size_t>(bufferFrames) * endpointBytesPerFrame);
            hr = renderClient->ReleaseBuffer(bufferFrames, 0);
          } else if (SUCCEEDED(hr)) hr = E_POINTER;
        }
        if (SUCCEEDED(hr)) hr = client->Start();
        if (FAILED(hr)) finished = true;
      } else if (result == WAIT_OBJECT_0 + 2) {
        hr = renderClient->GetBuffer(bufferFrames, &endpointBuffer);
        if (FAILED(hr) || !endpointBuffer) {
          finished = true;
          continue;
        }
        copyQueuedFrames(endpointBuffer, bufferFrames, sourceBuffer);
        hr = renderClient->ReleaseBuffer(bufferFrames, 0);
        if (FAILED(hr)) finished = true;
        else renderedFrames.fetch_add(bufferFrames, std::memory_order_relaxed);
      } else if (result == WAIT_FAILED || result == WAIT_TIMEOUT) {
        if (result == WAIT_FAILED) finished = true;
      }
    }
    client->Stop();
    client->Reset();
    running.store(false, std::memory_order_release);
    if (mmcss) AvRevertMmThreadCharacteristics(mmcss);
    CloseHandle(sampleEvent);
    sampleEvent = nullptr;
  }
};

WasapiExclusiveOutput::WasapiExclusiveOutput() : impl_(std::make_unique<Impl>()) {}
WasapiExclusiveOutput::~WasapiExclusiveOutput() { close(); }

bool WasapiExclusiveOutput::open(const std::wstring& endpointId, uint32_t sampleRate, uint32_t bits, std::string& error) {
  close();
  if (endpointId.empty() || sampleRate < 8000 || sampleRate > 192000 || (bits != 16 && bits != 32)) {
    error = "Invalid WASAPI exclusive output configuration.";
    return false;
  }
  impl_->bytesPerFrame = 2 * bits / 8;
  impl_->inputBits = bits;
  try {
    impl_->ring.assign(static_cast<size_t>(impl_->ringCapacityFrames) * impl_->bytesPerFrame, 0);
  } catch (const std::exception&) {
    error = "Could not allocate the WASAPI input buffer.";
    return false;
  }
  impl_->writtenFrames.store(0);
  impl_->readFrames.store(0);
  impl_->renderedFrames.store(0);
  impl_->underrunFrames.store(0);
  impl_->underrunEvents.store(0);
  impl_->discardTarget.store(0);
  impl_->discardGeneration.store(0);
  impl_->completedDiscardGeneration.store(0);
  impl_->discardedFrames.store(0);
  impl_->ready = false;
  impl_->startRequested = false;
  impl_->startFinished = false;
  impl_->startSucceeded = false;
  impl_->stopRequested = false;
  impl_->sampleRate.store(0);
  impl_->stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  impl_->resetEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!impl_->stopEvent || !impl_->resetEvent) {
    error = "Could not create WASAPI control events.";
    close();
    return false;
  }
  try {
    impl_->thread = std::thread(&Impl::run, impl_.get(), endpointId, sampleRate, bits);
  } catch (const std::exception& exception) {
    error = std::string("Could not start the WASAPI render thread: ") + exception.what();
    close();
    return false;
  }
  std::unique_lock<std::mutex> lock(impl_->mutex);
  impl_->readyChanged.wait(lock, [this]() { return impl_->ready; });
  if (!impl_->startupError.empty()) {
    error = impl_->startupError;
    lock.unlock();
    close();
    return false;
  }
  return true;
}

bool WasapiExclusiveOutput::start(std::string& error) {
  std::unique_lock<std::mutex> lock(impl_->mutex);
  if (!impl_->opened.load(std::memory_order_acquire) || !impl_->thread.joinable()) {
    error = "WASAPI exclusive output is not open.";
    return false;
  }
  impl_->startRequested = true;
  impl_->startChanged.notify_all();
  impl_->startChanged.wait(lock, [this]() { return impl_->startFinished || impl_->stopRequested; });
  if (impl_->stopRequested && !impl_->startFinished) {
    error = "WASAPI output closed before playback could start.";
    return false;
  }
  if (!impl_->startSucceeded) error = impl_->startError;
  return impl_->startSucceeded;
}

bool WasapiExclusiveOutput::write(const void* pcm, size_t size, std::string& error) {
  const uint32_t frameBytes = impl_->bytesPerFrame;
  if (!impl_->opened.load(std::memory_order_acquire) || !impl_->running.load(std::memory_order_acquire)
      || !pcm || frameBytes == 0 || size != static_cast<size_t>(kWriteFrames) * frameBytes) {
    error = "Invalid or stopped WASAPI PCM frame.";
    return false;
  }
  const uint64_t written = impl_->writtenFrames.load(std::memory_order_relaxed);
  const uint64_t read = impl_->readFrames.load(std::memory_order_acquire);
  if (written - std::min(written, read) + kWriteFrames > impl_->ringCapacityFrames) {
    error = "WASAPI output buffer overrun.";
    return false;
  }
  const uint64_t offset = written % impl_->ringCapacityFrames;
  const uint32_t firstFrames = static_cast<uint32_t>(
    std::min<uint64_t>(kWriteFrames, impl_->ringCapacityFrames - offset));
  const size_t firstBytes = static_cast<size_t>(firstFrames) * frameBytes;
  if (firstBytes) std::memcpy(impl_->ring.data() + offset * frameBytes, pcm, firstBytes);
  const size_t remaining = size - firstBytes;
  if (remaining) std::memcpy(impl_->ring.data(), static_cast<const uint8_t*>(pcm) + firstBytes, remaining);
  impl_->writtenFrames.store(written + kWriteFrames, std::memory_order_release);
  return true;
}

void WasapiExclusiveOutput::clear() {
  if (!impl_->opened.load(std::memory_order_acquire)) return;
  discard();
  if (impl_->resetEvent) SetEvent(impl_->resetEvent);
}

void WasapiExclusiveOutput::discard() {
  if (!impl_->opened.load(std::memory_order_acquire)) return;
  impl_->discardedFrames.store(0, std::memory_order_relaxed);
  impl_->discardTarget.store(impl_->writtenFrames.load(std::memory_order_acquire), std::memory_order_relaxed);
  impl_->discardGeneration.fetch_add(1, std::memory_order_release);
}

void WasapiExclusiveOutput::close() {
  if (!impl_) return;
  if (impl_->stopEvent) SetEvent(impl_->stopEvent);
  {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    impl_->stopRequested = true;
    impl_->startChanged.notify_all();
  }
  if (impl_->thread.joinable()) impl_->thread.join();
  if (impl_->stopEvent) CloseHandle(impl_->stopEvent);
  if (impl_->resetEvent) CloseHandle(impl_->resetEvent);
  impl_->stopEvent = nullptr;
  impl_->resetEvent = nullptr;
  impl_->opened.store(false, std::memory_order_release);
  impl_->running.store(false, std::memory_order_release);
  impl_->sampleRate.store(0, std::memory_order_release);
  impl_->ring.clear();
}

bool WasapiExclusiveOutput::isOpen() const { return impl_->opened.load(std::memory_order_acquire); }
bool WasapiExclusiveOutput::isRunning() const { return impl_->running.load(std::memory_order_acquire); }
bool WasapiExclusiveOutput::discardComplete() const {
  return impl_->completedDiscardGeneration.load(std::memory_order_acquire)
    >= impl_->discardGeneration.load(std::memory_order_acquire);
}
uint64_t WasapiExclusiveOutput::discardedFrames() const {
  return impl_->discardedFrames.load(std::memory_order_acquire);
}
uint64_t WasapiExclusiveOutput::queuedFrames() const {
  const uint64_t written = impl_->writtenFrames.load(std::memory_order_acquire);
  const uint64_t read = impl_->readFrames.load(std::memory_order_acquire);
  return written - std::min(written, read);
}
uint64_t WasapiExclusiveOutput::underrunFrames() const {
  return impl_->underrunFrames.load(std::memory_order_acquire);
}
uint64_t WasapiExclusiveOutput::underrunEvents() const {
  return impl_->underrunEvents.load(std::memory_order_acquire);
}
uint32_t WasapiExclusiveOutput::sampleRate() const {
  return impl_->sampleRate.load(std::memory_order_acquire);
}
double WasapiExclusiveOutput::streamTime() const {
  const uint32_t rate = sampleRate();
  return rate ? static_cast<double>(impl_->renderedFrames.load(std::memory_order_acquire)) / rate : 0.0;
}

#else

struct WasapiExclusiveOutput::Impl {};

WasapiExclusiveOutput::WasapiExclusiveOutput() : impl_(std::make_unique<Impl>()) {}
WasapiExclusiveOutput::~WasapiExclusiveOutput() = default;
bool WasapiExclusiveOutput::open(const std::wstring&, uint32_t, uint32_t, std::string& error) {
  error = "WASAPI exclusive output is only available on Windows.";
  return false;
}
bool WasapiExclusiveOutput::start(std::string& error) { error = "WASAPI is unavailable."; return false; }
bool WasapiExclusiveOutput::write(const void*, size_t, std::string& error) { error = "WASAPI is unavailable."; return false; }
void WasapiExclusiveOutput::clear() {}
void WasapiExclusiveOutput::discard() {}
void WasapiExclusiveOutput::close() {}
bool WasapiExclusiveOutput::isOpen() const { return false; }
bool WasapiExclusiveOutput::isRunning() const { return false; }
bool WasapiExclusiveOutput::discardComplete() const { return true; }
uint64_t WasapiExclusiveOutput::discardedFrames() const { return 0; }
uint64_t WasapiExclusiveOutput::queuedFrames() const { return 0; }
uint64_t WasapiExclusiveOutput::underrunFrames() const { return 0; }
uint64_t WasapiExclusiveOutput::underrunEvents() const { return 0; }
uint32_t WasapiExclusiveOutput::sampleRate() const { return 0; }
double WasapiExclusiveOutput::streamTime() const { return 0; }

#endif
