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

## Atmos for Headphones is different

Windows supports Dolby Atmos for Headphones through Dolby Access / Windows
Spatial Sound; this is not the same as sending an E-AC-3 bitstream to HDMI.
mpv's WASAPI compressed passthrough does **not** spatially render Atmos
objects for headphones. It would be misleading to label an FFmpeg 5.1
downmix as Atmos for Headphones.

A future native Windows playback route would use Microsoft Media Foundation
with Windows Spatial Sound (or a licensed compatible renderer), preserve
Atmos metadata until the OS renderer receives it, and validate actual
headphone-output behavior. That is a separate implementation from this
bitstream player, requiring Windows integration tests and compatible OS
decoders. Simply enabling Windows spatial sound on the Chromium PCM path
does not restore decoded-away Atmos object metadata.

References:
- https://mpv.io/manual/stable/#audio-spdif
- https://learn.microsoft.com/windows/win32/coreaudio/spatial-sound
- https://learn.microsoft.com/windows/win32/medfound/dolby-audio-decoder
