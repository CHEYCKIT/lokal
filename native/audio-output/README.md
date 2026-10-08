# Native PCM output

Lokal owns this small N-API bridge. It receives stereo PCM already processed by
Chromium/Web Audio. Shared output and the non-Windows backends use miniaudio;
the native layer also contains an event-driven Windows WASAPI exclusive route.
Exclusive mode is currently disabled in Lokal's settings and production bridge
because it underruns when the window is minimized; production native playback
uses shared mode.
For native shared output, Chromium stays connected to the selected speaker with
a silent AudioWorklet output, preserving the hardware clock that drives media
decoding and processing. Shared output can be converted by the system mixer.
The UI reports the app stream format, not the DAC's physical format.

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

The native audio callback never calls JavaScript or allocates. Miniaudio's SPSC
PCM ring holds at most 32768 frames in shared mode; the WASAPI exclusive render
thread consumes a separate 131072-frame SPSC buffer.
The AudioWorklet sends PCM through a transferred MessagePort directly to the
main process; the window's JavaScript thread is not part of audio delivery.
PCM arrays are cloned because Electron cannot deserialize browser-transferred
ArrayBuffers on MessagePortMain. Credits bound outstanding blocks.
When transport credits are delayed, the worklet retains up to 8 shared PCM
blocks (1024 sample frames each). With 24 in-flight credits, the combined
window fits the native ring's 32-block capacity.
Queue overload trims stale PCM at a WASAPI render boundary rather than stopping
and restarting the device. The exclusive endpoint is opened with an event
callback, negotiates a stable device period (including aligned-buffer retry),
and primes its endpoint buffer before playback starts. It prefers the requested
sample format and converts between float32 and PCM16 when the exclusive endpoint
accepts only the alternate format.
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
claiming physical-device support verified on those platforms. On Windows with
a stereo WASAPI endpoint, run `node scripts/native-wasapi-smoke.mjs` to exercise
exclusive PCM16/float32, caller-thread stalls, flush, discard, and stream
continuity on the connected device.

The desktop log records output mode changes and minimize/restore snapshots.
Native snapshots include queued blocks and callback-level underrun frame/event
counters, making device-specific stutter reproducible from the Settings › Debug
Logs file without logging every PCM block.
