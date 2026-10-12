// Lokal's receiver app (the page the TV shows while casting), as registered
// in the Google Cast SDK Developer Console: see docs/CASTING.md. Until it's
// registered and published, casting uses Google's Default Media Receiver.
// Settings → Playback → Casting → Receiver App ID overrides it (for testing a
// receiver on your own registered TV before it's published).
//
// The address registered for it: the receiver/ folder, published on GitHub
// Pages by .github/workflows/cast-receiver.yml.
const LOKAL_RECEIVER_URL = 'https://sipbuu.github.io/lokal/receiver/'
const LOKAL_CAST_APP_ID = null

module.exports = { LOKAL_CAST_APP_ID, LOKAL_RECEIVER_URL }
