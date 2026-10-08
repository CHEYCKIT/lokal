# Kotlin / Compose WASAPI output prototype

This is an isolated Windows desktop proof of concept for Lokal's playback-output boundary. It does not replace or edit the production Electron playback path. The Kotlin app exposes active output-device selection, Play/Stop, and PCM16 or float32 tone input. It generates a 440 Hz, 48 kHz stereo tone and submits fixed 1024-frame PCM blocks through JNI.

The JNI adapter calls Lokal's clean-room `native/audio-output/wasapi-exclusive.{h,cc}` implementation directly; it is referenced from the repository root and is not copied into this prototype. The Kotlin facade and UI are portable JVM/Compose code, but actual output remains Windows-native: WASAPI is a Windows COM API, so even a BitChord-style Kotlin architecture still needs native Windows code (or a library that supplies that native bridge). This prototype does not provide a cross-platform audio backend.

## Requirements

- Windows 10/11 x64
- JDK 17 with `JAVA_HOME` set
- Visual Studio 2019/2022 C++ x64 build tools and Windows SDK
- Gradle 8.10.2 or later

## Build and run

From this directory:

```powershell
.\build-native.bat
gradle test
gradle run
```

`gradle run` builds the JNI DLL first. The native build compiles the checked-in WASAPI implementation from `..\..\native\audio-output\wasapi-exclusive.cc` and places `lokal_wasapi.dll` under `build\native`. Set `-Dlokal.wasapi.library=C:\path\to\lokal_wasapi.dll` to load the JNI library from a different location. Exclusive mode requires the selected device to accept one of the requested sample formats; another application holding the endpoint can make open fail.

Run `gradle nativeSmoke` to enumerate active output devices and attempt a 1.5-second tone through the selected first endpoint.

## Scope and limitations

The generated tone validates device enumeration, exclusive open/start/stop, JNI calls, PCM format conversion, and the Kotlin fixed-block staging buffer. It is not a full Lokal playback engine: there is no media decoder, track switching, volume control, resampling, or production integration. Device support and audible output depend on the Windows host and its current endpoint formats.
