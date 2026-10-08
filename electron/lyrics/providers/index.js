// Every lyrics source Lokal can ask, in default priority order.
//
// Each provider exports: async fetch(query, ctx) -> { lines, doc?, isrc?, language? } | null
//   query = { title, artist, album, duration (s), isrc, filePath, searchTitle, searchArtist }
//   ctx   = { signal, hit? }  (hit = the BiniLyrics recording match, when identify ran)
//
// Order rationale (mirrors the listening experience, not the implementation):
//  - Your own file comes first: embedded tags or a sidecar .ttml/.lrc you put
//    there yourself is the most authoritative answer there is.
//  - Then the Apple Music catalogue (syllable-timed TTML, duets, background
//    vocals, and often Apple's own translation + romanization), from the host
//    that can match on the exact recording (ISRC) first.
//  - Then the finest-grained community timings, then the line-synced
//    workhorses, then plain text as a last resort.

const local = require('./local')
const bini = require('./bini')
const spicyLyrics = require('./spicyLyrics')
const betterLyrics = require('./betterLyrics')
const lyricsPlus = require('./lyricsPlus')
const unison = require('./unison')
const lrclib = require('./lrclib')
const kugou = require('./kugou')
const lyricsOvh = require('./lyricsOvh')

const PROVIDERS = [
  { id: 'local', label: 'Local file', detail: 'Lyrics embedded in the file, or a .ttml/.lrc next to it', wordSynced: true, fetch: local.fetch },
  { id: 'binilyrics', label: 'BiniLyrics', detail: 'Apple Music timings, matched on the exact recording', wordSynced: true, fetch: bini.fetch },
  { id: 'spicylyrics', label: 'Spicy Lyrics', detail: 'Community and catalogue syncs, including word-level timing', wordSynced: true, fetch: spicyLyrics.fetch },
  { id: 'betterlyrics', label: 'BetterLyrics', detail: 'Apple Music timings, word by word', wordSynced: true, fetch: betterLyrics.fetch },
  { id: 'betterlyrics_qq', label: 'BetterLyrics Portato', detail: 'QQ Music karaoke timings through BetterLyrics', wordSynced: true, fetch: betterLyrics.fetchPortato },
  { id: 'lyricsplus', label: 'LyricsPlus', detail: 'Syllable by syllable, on community mirrors', wordSynced: true, fetch: lyricsPlus.fetch },
  { id: 'unison', label: 'Unison', detail: 'Contributed by listeners, so it has what nobody licensed', wordSynced: true, fetch: unison.fetch },
  { id: 'lrclib', label: 'LRCLIB', detail: 'Whole lines only, and always up', wordSynced: false, fetch: lrclib.fetch },
  { id: 'kugou', label: 'KuGou', detail: 'Whole lines, strong outside the English catalogue', wordSynced: false, fetch: kugou.fetch },
  { id: 'lyricsovh', label: 'lyrics.ovh', detail: 'Plain text fallback', wordSynced: false, fetch: lyricsOvh.fetch },
]

const BY_ID = Object.fromEntries(PROVIDERS.map(p => [p.id, p]))
const DEFAULT_ORDER = PROVIDERS.map(p => p.id)

function describe() {
  return PROVIDERS.map(({ id, label, detail, wordSynced }) => ({ id, label, detail, wordSynced }))
}

module.exports = { PROVIDERS, BY_ID, DEFAULT_ORDER, describe, identify: bini.identify }
