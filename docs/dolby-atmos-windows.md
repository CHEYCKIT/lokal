# Dolby Atmos playback on Windows (Lokal desktop)

## What plays, and what is preserved

Tidal Mornye **Play** uses Lokal's normal Chromium/Web Audio path. Mornye may
transcode E-AC-3 to AAC for that path; decoded PCM/AAC cannot retain Dolby
Atmos object metadata.

**Play Atmos** is a separate, opt-in native HDMI passthrough route. It
downloads the original Tidal DOLBY_ATMOS E-AC-3 JOC stream and sends it to
mpv with the --audio-spdif=eac3 option and Windows WASAPI exclusive output.
This lets an Atmos-capable HDMI receiver or soundbar decode the original
bitstream. Lokal displays "playing" only when mpv reports spdif-eac3 output,
not merely because the source was catalogued as Atmos.

**Download** saves the Atmos stream independently of playback capability.

## Windows setup

1. Install mpv from https://mpv.io/installation/ . For example, install the
   shinchiro build with: winget install -e --id shinchiro.mpv
   Note: mpv.net is a different executable, not a replacement for mpv.exe.
2. Connect an E-AC-3/Atmos-capable receiver or soundbar over HDMI/eARC and
   choose the corresponding Windows audio endpoint.
3. In Lokal's **Atmos Setup** beside the Tidal Play Atmos button, verify
   that mpv is detected. If using a portable executable, choose **Locate mpv
   executable**; Lokal also searches common Scoop/WinGet installs and its
   app-specific bin directory.
4. In **Audio output**, explicitly choose the WASAPI HDMI receiver rather
   than headphones or the default device when necessary.
5. Press **Play Atmos**. The receiver should report Dolby Atmos when
   bitstream passthrough works; Lokal checks the mpv output format.

You can also use **Open local Atmos file…** in Atmos Setup to open a downloaded
.m4a/.mp4 E-AC-3 JOC file. Lokal requires FFprobe (available from
Settings > Tools) to verify the file's codec and Atmos profile before
claiming Atmos output.

### Manual mpv check

    mpv --audio-device=help
    mpv --no-config --ao=wasapi --audio-exclusive=yes --audio-spdif=eac3 --no-video "C:\Music\LISA - Tarantino.m4a"

With a specific HDMI endpoint, use --audio-device="wasapi/{YOUR-ENDPOINT-ID}"
in place of --ao=wasapi. Do not set both --ao and --audio-device.

The app's error states distinguish a missing mpv binary from HDMI output
failure. It does **not** claim to know receiver support before attempting
the stream.

## Headphones through Windows Spatial Sound (Windows 10/11)

Lokal's **Atmos Setup** now has a **Headphones · Windows Spatial Sound**
mode, independent of mpv and HDMI. On Windows this uses the native WinRT
MediaPlayer/Media Foundation pipeline, handing it the original E-AC-3 JOC
file without a preliminary FFmpeg downmix or conversion.

To configure:
1. Connect the headphones and choose them as the Windows default audio output.
2. Install Dolby Access from the Microsoft Store. A compatible license may
   be needed for Dolby Atmos for Headphones.
3. In Windows Settings > System > Sound > your headphones > Spatial sound,
   choose **Dolby Atmos for Headphones**.
4. In Lokal's Atmos Setup choose **Headphones · Windows Spatial Sound**.
5. Click **Play Atmos** or **Open local Atmos file**.

Lokal displays **Windows native headphone output**, not **verified Dolby
Atmos rendering**, because successfully opening E-AC-3 does not reveal
whether the actual JOC objects were rendered, or whether Windows decoded the
5.1 bed / downmixed stereo. The selected Spatial Sound implementation must
be configured in Windows; the app cannot set Dolby licensing, force its
installation, or verify decoded objects through the public MediaPlayer API.

Some fresh Windows 11 24H2 installations lack AC-3 decoding components by
default. If Media Foundation fails with a codec error, this native path
reports the failure rather than silently transcoding to stereo or pretending
the source was Atmos rendered.

The HDMI and headphone routes use the same original E-AC-3 JOC file and the
same native playback controls, but use fundamentally different output APIs.
Only the HDMI route reports a confirmed compressed E-AC-3 output. Windows
headphones report a native decoding/playback session, not a verified
object-rendering result.

### Source references

- https://learn.microsoft.com/windows/win32/coreaudio/spatial-sound
- https://learn.microsoft.com/windows/apps/develop/media-playback/play-audio-and-video-with-mediaplayer
- https://learn.microsoft.com/windows/win32/medfound/dolby-audio-decoder
- https://support.microsoft.com/en-us/windows/hardware/drivers/how-to-turn-on-spatial-sound-in-windows

