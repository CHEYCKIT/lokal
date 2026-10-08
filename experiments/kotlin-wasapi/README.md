# Kotlin / Compose file playback prototype

An isolated Windows desktop playback vertical slice, separate from Lokal's production Electron playback. The Compose UI opens a local audio file, selects an active output device and PCM16 or float32 output, and supports play, pause, resume, and stop. A Kotlin playback engine streams bounded 1024-frame decode blocks through a JNI facade to a shared-mode WASAPI renderer.

## Playback pipeline

```text
local file -> Java Sound decoder/SPI -> source-rate stereo PCM16 frames
           -> Kotlin bounded frame staging -> PCM16/float32 conversion
           -> JNI -> shared-mode WASAPI
```

This is a clean-room analogue, not BitChord's implementation: no BitChord or Astra source is copied or reused. BitChord's public [desktop documentation](https://github.com/kushagrasinghx/BitChord/blob/2c599a6cd7a195227a11dab5769f88da8fd08194/DESKTOP.md) identifies a Compose Multiplatform JVM desktop app. Its desktop playback is organized around `DesktopPlaybackEngine`, an FFmpeg-backed `DesktopAudioDecoder`, Float32 processing, and `DesktopAudioSink` (Java Sound with a Windows shared-mode WASAPI route); Android instead uses Media3's precision sink and canonical Float32 audio blocks. This prototype borrows only the general separation of playback engine, decoder, and output boundary. It uses Java Sound rather than FFmpeg, its own JNI WASAPI bridge, and has no DSP, route negotiation, production parity, or code sharing. See BitChord's [desktop engine](https://github.com/kushagrasinghx/BitChord/blob/2c599a6cd7a195227a11dab5769f88da8fd08194/desktopApp/src/main/kotlin/com/music/bitchord/desktop/DesktopAudioEngine.kt), [decoder](https://github.com/kushagrasinghx/BitChord/blob/2c599a6cd7a195227a11dab5769f88da8fd08194/desktopApp/src/main/kotlin/com/music/bitchord/desktop/DesktopAudioDecoder.kt), and [sink](https://github.com/kushagrasinghx/BitChord/blob/2c599a6cd7a195227a11dab5769f88da8fd08194/desktopApp/src/main/kotlin/com/music/bitchord/desktop/DesktopAudioSink.kt) for architectural reference. WASAPI still requires native Windows COM code even when the app/controller is Kotlin; JNI here wraps an isolated shared-mode renderer. Lokal's production Electron code and existing exclusive-mode backend are not modified.

Java Sound supplies WAV decoding; the `mp3spi` and `vorbisspi` providers extend decoding where their SPI format conversions are supported. FLAC decoding is not currently included. Unsupported inputs/conversions fail with an explicit error rather than being silently treated as PCM.

## Requirements and run

- Windows 10/11 x64
- JDK 17 (`JAVA_HOME`)
- Visual Studio 2019/2022 C++ x64 build tools and Windows SDK
- Gradle 8.10.2 or later

From this directory:

```powershell
.\build-native.bat
gradle test
gradle run
```

`gradle run` builds `build\native\lokal_wasapi.dll` automatically. The native build compiles only this experiment's `src\main\cpp\wasapi-shared.cpp` and JNI adapter. To exercise a generated local WAV on the first active endpoint in both PCM formats, run:

```powershell
gradle nativeSmoke
```

## Limits

This is a small local-file player, not a drop-in Lokal or BitChord engine. It has no queue, seeking, gapless transitions, volume/effects, or production integration. Audio conversion is delegated to installed Java Sound providers and Windows shared-mode WASAPI; supported codecs, rates, channel layouts, and device formats depend on those providers and the selected endpoint. WASAPI playback requires a working Windows audio device.
