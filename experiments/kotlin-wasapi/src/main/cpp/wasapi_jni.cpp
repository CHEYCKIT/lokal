#include <jni.h>

#include "wasapi-exclusive.h"

#include <windows.h>
#include <audioclient.h>
#include <propsys.h>
#include <functiondiscoverykeys_devpkey.h>
#include <mmdeviceapi.h>
#include <propvarutil.h>
#include <wrl/client.h>

#include <cstdint>
#include <exception>
#include <memory>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {

WasapiExclusiveOutput* outputFrom(jlong handle) {
  return reinterpret_cast<WasapiExclusiveOutput*>(static_cast<intptr_t>(handle));
}

jstring toJavaString(JNIEnv* env, const std::wstring& value) {
  return env->NewString(reinterpret_cast<const jchar*>(value.data()),
                        static_cast<jsize>(value.size()));
}

jstring toJavaString(JNIEnv* env, const std::string& value) {
  const int length = MultiByteToWideChar(CP_UTF8, 0, value.data(),
                                         static_cast<int>(value.size()), nullptr, 0);
  if (length == 0 && !value.empty()) return nullptr;
  std::wstring wide(static_cast<size_t>(length), L'\0');
  if (length > 0) {
    MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                        wide.data(), length);
  }
  return toJavaString(env, wide);
}

void throwIllegalState(JNIEnv* env, const std::string& message) {
  jclass exception = env->FindClass("java/lang/IllegalStateException");
  if (exception) env->ThrowNew(exception, message.c_str());
}

class ComScope {
public:
  ComScope() : result_(CoInitializeEx(nullptr, COINIT_MULTITHREADED)) {}
  ~ComScope() {
    if (SUCCEEDED(result_)) CoUninitialize();
  }
  HRESULT result() const { return result_; }

private:
  HRESULT result_;
};

}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL
Java_lokal_wasapi_JniWasapiOutput_nativeCreate(JNIEnv* env, jobject) {
  try {
    return static_cast<jlong>(reinterpret_cast<intptr_t>(new WasapiExclusiveOutput()));
  } catch (const std::exception& exception) {
    throwIllegalState(env, exception.what());
    return 0;
  }
}

JNIEXPORT jobjectArray JNICALL
Java_lokal_wasapi_JniWasapiOutput_nativeDevices(JNIEnv* env, jobject) {
  ComScope com;
  if (FAILED(com.result())) {
    throwIllegalState(env, "Could not initialize COM to enumerate WASAPI devices.");
    return nullptr;
  }

  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                IID_PPV_ARGS(enumerator.GetAddressOf()));
  ComPtr<IMMDeviceCollection> collection;
  if (SUCCEEDED(hr)) {
    hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE,
                                        collection.GetAddressOf());
  }
  if (FAILED(hr)) {
    throwIllegalState(env, "Could not enumerate active WASAPI output devices.");
    return nullptr;
  }

  jclass stringClass = env->FindClass("java/lang/String");
  jclass stringArrayClass = env->FindClass("[Ljava/lang/String;");
  if (!stringClass || !stringArrayClass) return nullptr;

  UINT count = 0;
  hr = collection->GetCount(&count);
  if (FAILED(hr)) {
    throwIllegalState(env, "Could not read the WASAPI device list.");
    return nullptr;
  }
  jobjectArray result = env->NewObjectArray(static_cast<jsize>(count), stringArrayClass, nullptr);
  if (!result) return nullptr;

  for (UINT index = 0; index < count; ++index) {
    ComPtr<IMMDevice> device;
    LPWSTR rawId = nullptr;
    hr = collection->Item(index, device.GetAddressOf());
    if (SUCCEEDED(hr)) hr = device->GetId(&rawId);
    if (FAILED(hr) || !rawId) {
      CoTaskMemFree(rawId);
      throwIllegalState(env, "Could not read a WASAPI device identifier.");
      return nullptr;
    }

    std::wstring id(rawId);
    CoTaskMemFree(rawId);
    std::wstring name = id;
    ComPtr<IPropertyStore> properties;
    hr = device->OpenPropertyStore(STGM_READ, properties.GetAddressOf());
    if (SUCCEEDED(hr)) {
      PROPVARIANT value;
      PropVariantInit(&value);
      hr = properties->GetValue(PKEY_Device_FriendlyName, &value);
      if (SUCCEEDED(hr) && value.vt == VT_LPWSTR && value.pwszVal) name = value.pwszVal;
      PropVariantClear(&value);
    }
    if (FAILED(hr)) {
      throwIllegalState(env, "Could not read a WASAPI device name.");
      return nullptr;
    }

    jobjectArray pair = env->NewObjectArray(2, stringClass, nullptr);
    jstring javaId = toJavaString(env, id);
    jstring javaName = toJavaString(env, name);
    if (!pair || !javaId || !javaName) return nullptr;
    env->SetObjectArrayElement(pair, 0, javaId);
    env->SetObjectArrayElement(pair, 1, javaName);
    env->SetObjectArrayElement(result, static_cast<jsize>(index), pair);
    env->DeleteLocalRef(pair);
    env->DeleteLocalRef(javaId);
    env->DeleteLocalRef(javaName);
  }
  return result;
}

JNIEXPORT jstring JNICALL
Java_lokal_wasapi_JniWasapiOutput_nativeOpen(JNIEnv* env, jobject, jlong handle,
                                              jstring javaId, jint sampleRate,
                                              jint bits) {
  WasapiExclusiveOutput* output = outputFrom(handle);
  if (!output || !javaId) return toJavaString(env, "Invalid native WASAPI handle or device.");
  const jchar* chars = env->GetStringChars(javaId, nullptr);
  if (!chars) return nullptr;
  const jsize length = env->GetStringLength(javaId);
  std::wstring id(reinterpret_cast<const wchar_t*>(chars), static_cast<size_t>(length));
  env->ReleaseStringChars(javaId, chars);
  std::string error;
  if (output->open(id, static_cast<uint32_t>(sampleRate),
                   static_cast<uint32_t>(bits), error)) return nullptr;
  return toJavaString(env, error);
}

JNIEXPORT jstring JNICALL
Java_lokal_wasapi_JniWasapiOutput_nativeStart(JNIEnv* env, jobject, jlong handle) {
  WasapiExclusiveOutput* output = outputFrom(handle);
  if (!output) return toJavaString(env, "Invalid native WASAPI handle.");
  std::string error;
  if (output->start(error)) return nullptr;
  return toJavaString(env, error);
}

JNIEXPORT jstring JNICALL
Java_lokal_wasapi_JniWasapiOutput_nativeWrite(JNIEnv* env, jobject, jlong handle,
                                               jbyteArray pcm) {
  WasapiExclusiveOutput* output = outputFrom(handle);
  if (!output || !pcm) return toJavaString(env, "Invalid native WASAPI handle or PCM data.");
  const jsize size = env->GetArrayLength(pcm);
  jbyte* bytes = env->GetByteArrayElements(pcm, nullptr);
  if (!bytes) return nullptr;
  std::string error;
  const bool succeeded = output->write(bytes, static_cast<size_t>(size), error);
  env->ReleaseByteArrayElements(pcm, bytes, JNI_ABORT);
  if (succeeded) return nullptr;
  return toJavaString(env, error);
}

JNIEXPORT void JNICALL
Java_lokal_wasapi_JniWasapiOutput_nativeClose(JNIEnv*, jobject, jlong handle) {
  WasapiExclusiveOutput* output = outputFrom(handle);
  if (output) output->close();
}

JNIEXPORT void JNICALL
Java_lokal_wasapi_JniWasapiOutput_nativeDestroy(JNIEnv*, jobject, jlong handle) {
  delete outputFrom(handle);
}

}  // extern "C"
