# ![KNOWN ISSUES](https://i.imgur.com/7O8qpvQ.png)

This file tracks known bugs and limitations. Some may be fixed in future updates.
*Last updated: 10/6/2026*

---

## Scanning

* **Converted videos detected as songs** — Files that were originally videos but converted to audio (e.g. MP4 to MP3) are indexed as normal tracks. Remove them from the library if you don't want them.

---

## Performance

* **UI slow under heavy system load** — Lokal draws with the graphics card. Games or other graphics-heavy apps running alongside it can make the UI stutter. Raising Lokal's process priority (Windows) may help, and turning off **Glass** (Settings › Appearance › Player Bar) lightens the load.

* **Rapid skipping during a crossfade** — Skipping several tracks quickly while a crossfade is running may briefly interrupt the smoothing.

---

## Playback

* **Volume during a crossfade** — Rapidly pausing/unpausing or changing the volume while a crossfade is running may cause small volume jumps while it re-syncs.

* **Crossfade under extreme load** — Heavy CPU usage can affect how smooth a crossfade sounds.

---

## Library

* **Artist images on first load** — Artist pictures fall back to album covers. Before the first full scan and lookup, some artists may show without a picture.

---

## Metadata

* **Songs without a genre** — Genres come from the file's tags or an online lookup. Settings › Library › Genres › **Fill In Genres** looks up the missing ones (and replaces the placeholder "Music" some files carry); songs iTunes doesn't know stay without one. You can set any genre yourself with **Set Genres**.

---

## Downloader

* **Playlist progress** — Progress for large playlists depends on what `yt-dlp` reports, so it can jump.

* **Error messages** — When `ffmpeg` or `yt-dlp` fails, the message doesn't always say why. Common causes (unreadable browser cookies, for example) are explained.

---

## Lyrics

* **No new lyrics offline** — Lyrics can't be fetched without an internet connection. Lyrics already fetched keep working.

* **Wrong lyrics version** — A source may return another version (live, remix, radio edit). Lookups use the song's length and album to avoid it; when it happens, use the search in the lyrics view.

* **Timing for plain lyrics** — For lyrics without timestamps, **Time Plain Lyrics** (Settings › Playback › Lyrics) estimates the timing; it may not line up exactly.

* **Cached lyrics fetched again** — In rare cases cached lyrics aren't found in the cache and are fetched again. The console logs show the cache status.

---

## Networking

* **Rate limits** — Many lyric searches or metadata lookups in a short time can fail for a while because of the services' rate limits.

---

## Web Mode

* **Localhost routing** — Some localhost setups can stop assets or the API from loading in web mode.

* **Artist images not loading** — If `LOKAL_DATA_DIR` is misconfigured, artist images won't load in the browser.

---
