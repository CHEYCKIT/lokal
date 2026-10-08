# Native PCM output

Lokal owns this small N-API bridge. It receives stereo PCM already processed by
Chromium/Web Audio, then miniaudio supplies WASAPI, CoreAudio, or the available
Linux audio backend. Shared output is the default; an opt-in Windows WASAPI exclusive mode bypasses
the system mixer. Exclusive initialization failure falls back to shared output.
Chromium uses a silent sink while the native route owns the device. Shared
output can be converted by the system mixer. The UI reports the app stream format, not the DAC's physical format.

- Vendor: miniaudio **0.11.23**, https://github.com/mackron/miniaudio/tree/0.11.23
- `vendor/miniaudio.h` SHA-256: `7e4f3f13c8fe66df2080ac3dd12a89193e3c2463cb7f067c798abd7331cd8ee6`
- License: the bundled upstream MIT / public-domain dual license (use MIT).
- No BitChord source code is included.

`npm run native:prepare` builds this bridge, then the existing Windows media
controls bridge where applicable. Requirements: Node 24, Python 3 and platform
C++ tools (MSVC Build Tools on Windows, Xcode command-line tools on macOS,
GCC/Clang and make on Linux). N-API 6 avoids an Electron-specific ABI rebuild.
The packaged binary lives in `electron/native` and is unpacked from ASAR.
If unavailable, the app keeps Auto/browser playback and disables explicit modes.

The native audio callback never calls JavaScript or allocates. The SPSC PCM ring
buffer holds at most 32768 frames in shared mode or 131072 in exclusive mode.
The AudioWorklet sends PCM through a transferred MessagePort directly to the
main process; the window's JavaScript thread is not part of audio delivery.
PCM arrays are cloned because Electron cannot deserialize browser-transferred
ArrayBuffers on MessagePortMain. Credits bound outstanding blocks.
When transport credits are delayed, the worklet also retains up to 8 shared or
32 exclusive PCM blocks (1024 sample frames each); combined with its 12/48
in-flight credits this remains below the native ring's 32/128-block capacity.
Queue overload trims stale PCM from the running callback rather than
stopping and restarting the device.
Flush messages use the same port as PCM to preserve ordering across seeks.
Incoming ports are restricted to the main player frame, and sessions reject
stale blocks. Flush stops the consumer before resetting the native ring.

Native streams open only during playback. Pause/stop closes the native stream
and suspends the AudioContext, including in Auto mode. Shared native playback
also uses Chromium's silent sink to avoid opening a second speaker client.
The SMTC silence element is paused during native negotiation/playback.

Validation: `node --test scripts/native-output.test.mjs`, then (on Linux with a
PulseAudio null sink named `lokal_test`) `xvfb-run -a node scripts/native-output-smoke.mjs`.
The latter records actual local/HTTP decoded output, both precision modes,
pause/seek, idle release, gain, EQ/mixing, fallback, and continuous audio during
800 ms renderer-thread stalls before/after a minimize request. Test Windows/macOS devices before
claiming physical-device support verified on those platforms.
