// Lokal's receiver app (the page the TV shows while casting), as registered
// in the Google Cast SDK Developer Console: see docs/CASTING.md. Lokal's own
// receiver is used by default; if it can't start, casting falls back to Google's
// Default Media Receiver.
//
// The address registered for it: the receiver/ folder, published on GitHub
// Pages by .github/workflows/cast-receiver.yml.
const LOKAL_RECEIVER_URL = 'https://sipbuu.github.io/lokal/receiver/'
const LOKAL_CAST_APP_ID = '2060B9B3'

module.exports = { LOKAL_CAST_APP_ID, LOKAL_RECEIVER_URL }
