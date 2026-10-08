#include "wasapi-shared.h"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <thread>

using Microsoft::WRL::ComPtr;

struct WasapiSharedOutput::Impl {
  ComPtr<IMMDevice> device;
  ComPtr<IAudioClient> client;
  ComPtr<IAudioRenderClient> renderer;
  UINT32 bufferFrames = 0;
  uint32_t bytesPerFrame = 0;
  bool comInitialized = false;
  bool running = false;
  DWORD ownerThread = 0;
};

namespace {

std::string hresultMessage(const char* action, HRESULT result) {
  std::ostringstream message;
  message << action << " failed (HRESULT 0x" << std::uppercase << std::hex
          << std::setw(8) << std::setfill('0') << static_cast<uint32_t>(result)
          << ").";
  return message.str();
}

}  // namespace

WasapiSharedOutput::WasapiSharedOutput() : impl_(std::make_unique<Impl>()) {}

WasapiSharedOutput::~WasapiSharedOutput() { close(); }

bool WasapiSharedOutput::open(const std::wstring& endpointId, uint32_t sampleRate,
                              uint32_t bits, std::string& error) {
  close();
  if (endpointId.empty() || sampleRate < 8000 || sampleRate > 192000 ||
      (bits != 16 && bits != 32)) {
    error = "Invalid shared WASAPI output configuration.";
    return false;
  }

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) {
    error = hresultMessage("COM initialization", hr);
    return false;
  }
  impl_->comInitialized = true;
  impl_->ownerThread = GetCurrentThreadId();

  ComPtr<IMMDeviceEnumerator> enumerator;
  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                        IID_PPV_ARGS(enumerator.GetAddressOf()));
  if (FAILED(hr)) {
    error = hresultMessage("WASAPI device enumerator creation", hr);
    close();
    return false;
  }
  hr = enumerator->GetDevice(endpointId.c_str(), impl_->device.GetAddressOf());
  if (FAILED(hr)) {
    error = hresultMessage("WASAPI endpoint lookup", hr);
    close();
    return false;
  }
  hr = impl_->device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                               reinterpret_cast<void**>(impl_->client.GetAddressOf()));
  if (FAILED(hr)) {
    error = hresultMessage("WASAPI audio client activation", hr);
    close();
    return false;
  }

  WAVEFORMATEX format{};
  format.wFormatTag = bits == 32 ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM;
  format.nChannels = 2;
  format.nSamplesPerSec = sampleRate;
  format.wBitsPerSample = static_cast<WORD>(bits);
  format.nBlockAlign = static_cast<WORD>(format.nChannels * bits / 8);
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
  impl_->bytesPerFrame = format.nBlockAlign;

  hr = impl_->client->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_NOPERSIST | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
          AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
      1'000'000, 0, &format, nullptr);
  if (FAILED(hr)) {
    error = hresultMessage(
        bits == 32 ? "Shared WASAPI Float32 initialization"
                   : "Shared WASAPI PCM16 initialization",
        hr);
    close();
    return false;
  }
  hr = impl_->client->GetBufferSize(&impl_->bufferFrames);
  if (SUCCEEDED(hr)) {
    hr = impl_->client->GetService(__uuidof(IAudioRenderClient),
                                   reinterpret_cast<void**>(impl_->renderer.GetAddressOf()));
  }
  if (FAILED(hr)) {
    error = hresultMessage("WASAPI render client setup", hr);
    close();
    return false;
  }
  BYTE* initialBuffer = nullptr;
  hr = impl_->renderer->GetBuffer(impl_->bufferFrames, &initialBuffer);
  if (SUCCEEDED(hr) && initialBuffer) {
    hr = impl_->renderer->ReleaseBuffer(impl_->bufferFrames, AUDCLNT_BUFFERFLAGS_SILENT);
  } else if (SUCCEEDED(hr)) {
    hr = E_POINTER;
  }
  if (FAILED(hr)) {
    error = hresultMessage("WASAPI render buffer priming", hr);
    close();
    return false;
  }
  return true;
}

bool WasapiSharedOutput::start(std::string& error) {
  if (!impl_->client || impl_->ownerThread != GetCurrentThreadId()) {
    error = "WASAPI output must be started on its opening playback thread.";
    return false;
  }
  const HRESULT hr = impl_->client->Start();
  if (FAILED(hr)) {
    error = hresultMessage("WASAPI playback start", hr);
    return false;
  }
  impl_->running = true;
  return true;
}

bool WasapiSharedOutput::pause(std::string& error) {
  if (!impl_->client || !impl_->running || impl_->ownerThread != GetCurrentThreadId()) {
    error = "WASAPI output must be paused on its running playback thread.";
    return false;
  }
  const HRESULT hr = impl_->client->Stop();
  if (FAILED(hr)) {
    error = hresultMessage("WASAPI playback pause", hr);
    return false;
  }
  impl_->running = false;
  return true;
}

bool WasapiSharedOutput::write(const void* pcm, size_t size, std::string& error) {
  if (!impl_->running || impl_->ownerThread != GetCurrentThreadId() || !pcm ||
      impl_->bytesPerFrame == 0 || size == 0 ||
      size % impl_->bytesPerFrame != 0) {
    error = "Invalid or stopped shared WASAPI PCM frame.";
    return false;
  }

  const auto* source = static_cast<const BYTE*>(pcm);
  UINT32 remainingFrames = static_cast<UINT32>(size / impl_->bytesPerFrame);
  while (remainingFrames > 0) {
    UINT32 padding = 0;
    HRESULT hr = impl_->client->GetCurrentPadding(&padding);
    if (FAILED(hr)) {
      error = hresultMessage("WASAPI buffer query", hr);
      return false;
    }
    const UINT32 availableFrames =
        padding < impl_->bufferFrames ? impl_->bufferFrames - padding : 0;
    if (availableFrames == 0) {
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
      continue;
    }

    const UINT32 frames = std::min(remainingFrames, availableFrames);
    BYTE* destination = nullptr;
    hr = impl_->renderer->GetBuffer(frames, &destination);
    if (FAILED(hr) || !destination) {
      error = hresultMessage("WASAPI render buffer acquisition",
                            FAILED(hr) ? hr : E_POINTER);
      return false;
    }
    const size_t byteCount = static_cast<size_t>(frames) * impl_->bytesPerFrame;
    std::memcpy(destination, source, byteCount);
    hr = impl_->renderer->ReleaseBuffer(frames, 0);
    if (FAILED(hr)) {
      error = hresultMessage("WASAPI render buffer submission", hr);
      return false;
    }
    source += byteCount;
    remainingFrames -= frames;
  }
  return true;
}

void WasapiSharedOutput::close() {
  if (impl_->client && impl_->running &&
      impl_->ownerThread == GetCurrentThreadId()) {
    impl_->client->Stop();
  }
  impl_->running = false;
  impl_->renderer.Reset();
  impl_->client.Reset();
  impl_->device.Reset();
  impl_->bufferFrames = 0;
  impl_->bytesPerFrame = 0;
  if (impl_->comInitialized && impl_->ownerThread == GetCurrentThreadId()) {
    CoUninitialize();
    impl_->comInitialized = false;
    impl_->ownerThread = 0;
  }
}
