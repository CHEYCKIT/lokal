# Yandex Music package for Lokal

This is an installable SpotiFLAC-compatible download package for Lokal. It adapts the API and encrypted-audio download flow from yandex-music-downloader, the MIT-licensed project at https://gitcode.com/gh_mirrors/ya/yandex-music-downloader.

## Install

Use Lokal Settings → Addons → SpotiFLAC packages and provide the direct URL of the published .sflx archive. A source-directory URL is not installable.

## Configure

Open the installed Yandex Music addon and paste an OAuth token for your own Yandex Music account into the token field. Lokal stores the token with the addon's encrypted settings. A valid token does not guarantee every track is available; Yandex may restrict content or quality by account, region, or subscription.

The package provides track, album, and artist search; album and artist pages; Yandex Music track, album, and artist URLs; lossless downloads where Yandex returns FLAC; and AAC/MP3 fallback with the high-quality option. Encrypted audio is decrypted in bounded chunks so large files do not have to fit in memory.

## Legal and licensing notes

This is an unofficial integration and is not affiliated with Yandex. Use it only with a token and content you are authorized to access, and follow applicable service terms and copyright law. The signing and AES-CTR audio flow is adapted from the MIT-licensed project; see LICENSE for the required notice.
