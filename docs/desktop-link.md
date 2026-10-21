# Desktop link v1

Enable Phone Remote in Lokal settings, open its Linked devices panel, and choose Pair a phone. On Android open You → Devices (also available in settings and optional onboarding), then scan the QR code or enter the desktop address and code. Both devices must be on the same local network. The code expires after two minutes and can be used once. Revoke a phone from the desktop panel to invalidate its token and close its socket.

The desktop panel can control connected phone playback or transfer playback in either direction. Android can select the desktop as its playback target while retaining the existing player interface. Missing phone files are copied to the desktop only with the phone's explicit download-sharing option; otherwise handoff reports the unavailable songs. Imported desktop-only songs remain placeholders until streamed, cached, or downloaded. Original files are never moved or deleted by linking.

Pairing and synchronization are separate: the phone previews the merge before enabling it. History merges by event ID. Library mutations use append-only operation IDs, hybrid logical clocks, per-field conflict resolution, explicit playlist tombstones, stable playlist UUIDs, and numeric positions with deterministic track-key ordering. Missing rows never imply deletion. Imported listening events do not invoke external scrobblers. Sync cursors are scoped to desktop and user profile. Theme adoption requires an explicit setting on the receiving device.

The LAN protocol uses `_lokal._tcp.local` discovery, sharing the multicast socket with Cast. Pairing is POST `/api/remote/pair`; playback and journal exchange use `/api/remote/ws`. Messages have `{v:1,type,id,ts,body}`. Request IDs correlate replies. State messages carry semantic changes and seeks; clients extrapolate position from `positionAt`. Sockets use heartbeat and Android reconnect/backoff; manual address and legacy polling remain available.

Device bearer tokens are random, hashed in desktop SQLite and kept in Android secure storage. They authorize the remote/media surface, not the general settings/filesystem API. Audio copies go through the bounded, checksummed `/api/remote/files` endpoint and promote matching placeholders in place. QR images are generated locally. The transport is intended for a trusted LAN; it does not add TLS to the existing HTTP server.

The implementation has not been built or exercised on physical devices. CI, tests and builds were skipped at the user's request.
