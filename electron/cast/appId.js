// Lokal's receiver app (the page the TV shows while casting), as registered
// in the Google Cast SDK Developer Console: see docs/CASTING.md. Until it's
// registered and published, casting uses Google's Default Media Receiver.
// Settings → Playback → Casting → Receiver app ID overrides it (for testing a
// receiver on your own registered TV before it's published).
const LOKAL_CAST_APP_ID = null

module.exports = { LOKAL_CAST_APP_ID }
