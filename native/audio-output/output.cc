#include <node_api.h>
#include <algorithm>
#include <atomic>
#include <cstring>
#include <vector>
#include "wasapi-exclusive.h"
#define MINIAUDIO_IMPLEMENTATION
#include "vendor/miniaudio.h"

// One context per Node environment. The audio callback never touches JS and
// never allocates. miniaudio's SPSC ring buffer bounds memory and latency.
struct Output {
  ma_context context{};
  ma_device device{};
  ma_pcm_rb ring{};
  WasapiExclusiveOutput wasapi;
  bool usingWasapiExclusive = false;
  bool initialized = false, open = false;
  std::atomic<uint64_t> frames{0};
  std::atomic<uint64_t> writtenFrames{0}, consumedFrames{0}, discardUntil{0}, discardedFrames{0};
  std::atomic<uint64_t> underrunFrames{0}, underrunEvents{0};
  std::atomic<bool> discardRequested{false}, discardComplete{true};
  std::vector<ma_device_id> ids;
  void close() {
    if (usingWasapiExclusive) {
      wasapi.close();
      usingWasapiExclusive = false;
    }
    if (open) { ma_device_uninit(&device); ma_pcm_rb_uninit(&ring); open = false; }
  }
  ~Output() { close(); if (initialized) ma_context_uninit(&context); }
};
static void render(ma_device* device, void* buffer, const void*, ma_uint32 count) {
  auto* self = static_cast<Output*>(device->pUserData);
  const auto bytes = ma_get_bytes_per_frame(device->playback.format, 2);
  std::memset(buffer, 0, count * bytes);
  auto consumed = self->consumedFrames.load(std::memory_order_relaxed);
  if (self->discardRequested.load(std::memory_order_acquire)) {
    const auto discardUntil = self->discardUntil.load(std::memory_order_acquire);
    while (consumed < discardUntil) {
      const ma_uint32 available = ma_pcm_rb_available_read(&self->ring);
      if (!available) break;
      ma_uint32 discarded = static_cast<ma_uint32>(std::min<uint64_t>(available, discardUntil - consumed));
      void* input = nullptr;
      ma_pcm_rb_acquire_read(&self->ring, &discarded, &input);
      if (!discarded) break;
      ma_pcm_rb_commit_read(&self->ring, discarded);
      consumed += discarded;
      self->discardedFrames.fetch_add(discarded, std::memory_order_relaxed);
    }
    if (consumed >= discardUntil) {
      self->discardRequested.store(false, std::memory_order_relaxed);
      self->discardComplete.store(true, std::memory_order_release);
    }
  }
  ma_uint32 done = 0;
  while (done < count) {
    ma_uint32 available = count - done; void* input = nullptr;
    ma_pcm_rb_acquire_read(&self->ring, &available, &input);
    if (!available) break;
    std::memcpy(static_cast<char*>(buffer) + done * bytes, input, available * bytes);
    ma_pcm_rb_commit_read(&self->ring, available); done += available; consumed += available;
  }
  if (done < count) {
    self->underrunFrames.fetch_add(count - done, std::memory_order_relaxed);
    self->underrunEvents.fetch_add(1, std::memory_order_relaxed);
  }
  self->consumedFrames.store(consumed, std::memory_order_release);
  self->frames.fetch_add(count, std::memory_order_relaxed);
}
static napi_value error(napi_env env, const char* message) { napi_throw_error(env, nullptr, message); return nullptr; }
static napi_value number(napi_env env, double n) { napi_value v; napi_create_double(env, n, &v); return v; }
static napi_value booleanValue(napi_env env, bool b) { napi_value v; napi_get_boolean(env, b, &v); return v; }
static napi_value string(napi_env env, const char* s) { napi_value v; napi_create_string_utf8(env, s, NAPI_AUTO_LENGTH, &v); return v; }
static napi_value nothing(napi_env env) { napi_value v; napi_get_undefined(env, &v); return v; }
static Output* state(napi_env env) { void* p; napi_get_instance_data(env, &p); return static_cast<Output*>(p); }
static bool init(Output* self) {
  if (self->initialized) return true;
  self->initialized = ma_context_init(nullptr, 0, nullptr, &self->context) == MA_SUCCESS;
  return self->initialized;
}
static napi_value devices(napi_env env, napi_callback_info) {
  auto* self = state(env);
  if (!init(self)) return error(env, "No native audio backend is available.");
  ma_device_info* infos = nullptr; ma_uint32 count = 0;
  if (ma_context_get_devices(&self->context, &infos, &count, nullptr, nullptr) != MA_SUCCESS) return error(env, "Could not list audio devices.");
  self->ids.clear(); napi_value result; napi_create_array_with_length(env, count, &result);
  for (ma_uint32 i = 0; i < count; i++) {
    self->ids.push_back(infos[i].id);
    napi_value entry; napi_create_object(env, &entry);
    napi_set_named_property(env, entry, "id", number(env, i));
    napi_set_named_property(env, entry, "name", string(env, infos[i].name));
    napi_set_named_property(env, entry, "isDefaultOutput", booleanValue(env, infos[i].isDefault));
    // Channel support is negotiated when opening the stream.
    napi_set_named_property(env, entry, "outputChannels", number(env, 2));
    napi_set_element(env, result, i, entry);
  }
  return result;
}
static napi_value open(napi_env env, napi_callback_info info) {
  auto* self = state(env); self->close();
  size_t argc = 4; napi_value args[4]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  uint32_t id, rate, bits; bool exclusive = false;
  if (argc != 4 || napi_get_value_bool(env, args[3], &exclusive) != napi_ok || napi_get_value_uint32(env, args[0], &id) != napi_ok || napi_get_value_uint32(env, args[1], &rate) != napi_ok || napi_get_value_uint32(env, args[2], &bits) != napi_ok || id >= self->ids.size() || rate < 8000 || rate > 192000 || (bits != 16 && bits != 32)) return error(env, "Invalid audio configuration.");
  if (exclusive && self->context.backend != ma_backend_wasapi) return error(env, "Exclusive output requires Windows WASAPI.");
#if defined(_WIN32)
  if (exclusive) {
    std::string message;
    if (!self->wasapi.open(std::wstring(self->ids[id].wasapi), rate, bits, message)) return error(env, message.c_str());
    self->usingWasapiExclusive = true;
    return number(env, 1024);
  }
#endif
  const ma_format format = bits == 32 ? ma_format_f32 : ma_format_s16;
  if (ma_pcm_rb_init(format, 2, 32768, nullptr, nullptr, &self->ring) != MA_SUCCESS) return error(env, "Could not allocate audio buffer.");
  ma_device_config config = ma_device_config_init(ma_device_type_playback);
  config.playback.pDeviceID = &self->ids[id]; config.playback.format = format; config.playback.channels = 2;
  config.playback.shareMode = exclusive ? ma_share_mode_exclusive : ma_share_mode_shared;
  config.wasapi.noAutoConvertSRC = exclusive ? MA_TRUE : MA_FALSE;
  config.sampleRate = rate; config.periodSizeInFrames = 1024; config.dataCallback = render; config.pUserData = self;
  if (ma_device_init(&self->context, &config, &self->device) != MA_SUCCESS) {
    ma_pcm_rb_uninit(&self->ring); return error(env, "The device could not accept this output format.");
  }
  self->open = true; self->frames.store(0); self->writtenFrames.store(0); self->consumedFrames.store(0);
  self->discardUntil.store(0); self->discardRequested.store(false); self->discardComplete.store(true);
  self->discardedFrames.store(0);
  self->underrunFrames.store(0); self->underrunEvents.store(0);
  return number(env, 1024);
}
static napi_value start(napi_env env, napi_callback_info) {
  auto* self = state(env);
  if (self->usingWasapiExclusive) {
    std::string message;
    if (!self->wasapi.start(message)) return error(env, message.c_str());
    return nothing(env);
  }
  if (!self->open || ma_device_start(&self->device) != MA_SUCCESS) return error(env, "Could not start audio output.");
  return nothing(env);
}
static napi_value close(napi_env env, napi_callback_info) { state(env)->close(); return nothing(env); }
static napi_value isOpen(napi_env env, napi_callback_info) { auto* s = state(env); return booleanValue(env, s->usingWasapiExclusive ? s->wasapi.isOpen() : s->open); }
static napi_value isRunning(napi_env env, napi_callback_info) { auto* s = state(env); return booleanValue(env, s->usingWasapiExclusive ? s->wasapi.isRunning() : s->open && ma_device_is_started(&s->device)); }
static napi_value rate(napi_env env, napi_callback_info) { auto* s = state(env); return number(env, s->usingWasapiExclusive ? s->wasapi.sampleRate() : s->open ? s->device.sampleRate : 0); }
static napi_value time(napi_env env, napi_callback_info) { auto* s = state(env); return number(env, s->usingWasapiExclusive ? s->wasapi.streamTime() : s->open ? double(s->frames.load()) / s->device.sampleRate : 0); }
static napi_value backend(napi_env env, napi_callback_info) { auto* s = state(env); return string(env, s->initialized ? ma_get_backend_name(s->context.backend) : "Unavailable"); }
static napi_value supportsExclusive(napi_env env, napi_callback_info) {
  auto* s = state(env); return booleanValue(env, init(s) && s->context.backend == ma_backend_wasapi);
}
static napi_value isExclusive(napi_env env, napi_callback_info) {
  auto* s = state(env); return booleanValue(env, s->usingWasapiExclusive || s->open && s->device.playback.shareMode == ma_share_mode_exclusive);
}
static napi_value clear(napi_env env, napi_callback_info) {
  auto* s = state(env);
  if (s->usingWasapiExclusive) {
    s->wasapi.clear();
    return nothing(env);
  }
  if (s->open) {
    // Stop the consumer before resetting both ring cursors.
    bool running = ma_device_is_started(&s->device);
    if (ma_device_stop(&s->device) != MA_SUCCESS) return error(env, "Could not flush audio output.");
    ma_pcm_rb_reset(&s->ring);
    s->writtenFrames.store(0); s->consumedFrames.store(0); s->discardUntil.store(0);
    s->discardRequested.store(false); s->discardComplete.store(true); s->discardedFrames.store(0);
    if (running && ma_device_start(&s->device) != MA_SUCCESS) return error(env, "Could not resume audio output.");
  }
  return nothing(env);
}
static napi_value discard(napi_env env, napi_callback_info) {
  auto* s = state(env);
  if (s->usingWasapiExclusive) {
    s->wasapi.discard();
    return nothing(env);
  }
  if (s->open && !s->discardRequested.load(std::memory_order_acquire)) {
    s->discardComplete.store(false, std::memory_order_relaxed);
    s->discardedFrames.store(0, std::memory_order_relaxed);
    s->discardUntil.store(s->writtenFrames.load(std::memory_order_acquire), std::memory_order_relaxed);
    s->discardRequested.store(true, std::memory_order_release);
  }
  return nothing(env);
}
static napi_value discardComplete(napi_env env, napi_callback_info) {
  auto* s = state(env);
  if (s->usingWasapiExclusive) return booleanValue(env, s->wasapi.discardComplete());
  return booleanValue(env, !s->open || s->discardComplete.load(std::memory_order_acquire));
}
static napi_value discardedFrames(napi_env env, napi_callback_info) {
  auto* s = state(env);
  return number(env, static_cast<double>(s->usingWasapiExclusive
    ? s->wasapi.discardedFrames()
    : s->discardedFrames.load(std::memory_order_acquire)));
}
static napi_value diagnostics(napi_env env, napi_callback_info) {
  auto* s = state(env);
  const bool exclusive = s->usingWasapiExclusive;
  const uint64_t written = s->writtenFrames.load(std::memory_order_acquire);
  const uint64_t consumed = s->consumedFrames.load(std::memory_order_acquire);
  const uint64_t underrunFrames = exclusive
    ? s->wasapi.underrunFrames() : s->underrunFrames.load(std::memory_order_acquire);
  const uint64_t underrunEvents = exclusive
    ? s->wasapi.underrunEvents() : s->underrunEvents.load(std::memory_order_acquire);
  const uint64_t queuedFrames = exclusive
    ? s->wasapi.queuedFrames()
    : written - std::min(written, consumed);
  napi_value result; napi_create_object(env, &result);
  napi_set_named_property(env, result, "underrunFrames", number(env, static_cast<double>(underrunFrames)));
  napi_set_named_property(env, result, "underrunEvents", number(env, static_cast<double>(underrunEvents)));
  napi_set_named_property(env, result, "queuedFrames", number(env, static_cast<double>(queuedFrames)));
  napi_set_named_property(env, result, "streamTime", number(env, exclusive
    ? s->wasapi.streamTime() : s->open && s->device.sampleRate
      ? static_cast<double>(s->frames.load(std::memory_order_acquire)) / s->device.sampleRate : 0.0));
  return result;
}
static napi_value write(napi_env env, napi_callback_info info) {
  auto* s = state(env); size_t argc = 1, size = 0; napi_value args[1]; void* input = nullptr; bool isBuffer = false;
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 1 || napi_is_buffer(env, args[0], &isBuffer) != napi_ok || !isBuffer || napi_get_buffer_info(env, args[0], &input, &size) != napi_ok) return error(env, "Invalid audio frame.");
  if (s->usingWasapiExclusive) {
    std::string message;
    if (!s->wasapi.write(input, size, message)) return error(env, message.c_str());
    return nothing(env);
  }
  if (!s->open) return error(env, "Invalid audio frame.");
  auto bytes = ma_get_bytes_per_frame(s->device.playback.format, 2);
  if (size != 1024 * bytes) return error(env, "Invalid audio frame length.");
  if (ma_pcm_rb_available_write(&s->ring) < 1024) return error(env, "Audio buffer overrun.");
  ma_uint32 done = 0;
  while (done < 1024) {
    ma_uint32 available = 1024 - done; void* output = nullptr;
    ma_pcm_rb_acquire_write(&s->ring, &available, &output);
    if (!available) return error(env, "Audio buffer is full.");
    std::memcpy(output, static_cast<char*>(input) + done * bytes, available * bytes);
    ma_pcm_rb_commit_write(&s->ring, available); done += available;
  }
  s->writtenFrames.fetch_add(done, std::memory_order_release);
  return nothing(env);
}
static napi_value setup(napi_env env, napi_value exports) {
  auto* self = new Output();
  napi_set_instance_data(env, self, [](napi_env, void* data, void*) { delete static_cast<Output*>(data); }, nullptr);
  const napi_property_descriptor methods[] = {
    {"supportsExclusive", nullptr, supportsExclusive, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"isExclusive", nullptr, isExclusive, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"getDevices", nullptr, devices, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"open", nullptr, open, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"start", nullptr, start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeStream", nullptr, close, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"isStreamOpen", nullptr, isOpen, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"isStreamRunning", nullptr, isRunning, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"getStreamSampleRate", nullptr, rate, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"getApi", nullptr, backend, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"streamTime", nullptr, nullptr, time, nullptr, nullptr, napi_default, nullptr},
    {"write", nullptr, write, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"clearOutputQueue", nullptr, clear, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"discardOutputQueue", nullptr, discard, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"isOutputQueueDiscardComplete", nullptr, discardComplete, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"getDiscardedFrames", nullptr, discardedFrames, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"getDiagnostics", nullptr, diagnostics, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, setup)
