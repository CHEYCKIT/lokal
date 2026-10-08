# Native PCM output

Lokal owns this small N-API bridge. It receives stereo PCM already processed by
Chromium/Web Audio, then miniaudio supplies WASAPI, CoreAudio, or the available
Linux audio backend. It uses shared output; the system mixer can convert sample
format/rate. The UI reports the app stream format, not the DAC's physical format.

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

The audio thread never calls JavaScript or allocates. The SPSC PCM ring buffer
is limited to 8192 frames. Flush stops the consumer before resetting the ring.
Incoming IPC is restricted to the main player frame, sessions reject stale
blocks, and both the worklet and the main process bound queued audio.

Validation: `node --test scripts/native-output.test.mjs`, then (on Linux with a
PulseAudio null sink named `lokal_test`) `xvfb-run -a node scripts/native-output-smoke.mjs`.
The latter records actual local/HTTP decoded output, both precision modes,
pause/seek, gain, EQ/mixing, and fallback. Test Windows/macOS devices before
claiming physical-device support verified on those platforms.
