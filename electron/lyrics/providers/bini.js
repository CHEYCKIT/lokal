// BiniLyrics: Apple Music TTML, and the only host that answers to a *recording*
// (ISRC) rather than a name.
//
// A single and its album cut share a title, an artist and nearly a length, and
// routinely differ in the words. An ISRC names one recording and settles it.
// A search here also reports the ISRC of whatever it matched, which the
// repository hands on to other sources that can use one (LyricsPlus).
//
// Two requests: the search returns a URL, and the TTML is fetched from there.

const { getJson, getText, withQuery } = require('../http')
const { forLyricsSearch } = require('../names')

const BASE = 'https://lyrics-api.binimum.org/'

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const TIMING_WEIGHT = { word: 3, line: 1, none: -2 }

function pick(results, query) {
  if (!Array.isArray(results) || !results.length) return null
  const duration = Number(query.duration) || 0
  const wantTitle = normalize(query.searchTitle || query.title)
  const wantArtist = normalize(query.searchArtist || query.artist)
  const scored = results.map((hit, index) => {
    let score = 0
    // Catalogue titles carry the same noise ours do ("(2013 Remaster)").
    const title = normalize(forLyricsSearch(hit.track_name))
    if (title === wantTitle) score += 4
    else if (title.startsWith(wantTitle) || wantTitle.startsWith(title)) score += 2
    else score -= 2
    const artist = normalize(hit.artist_name)
    if (artist && wantArtist && (artist === wantArtist || artist.includes(wantArtist) || wantArtist.includes(artist))) score += 2
    if (duration > 0 && hit.duration) {
      const diff = Math.abs(hit.duration - duration)
      if (diff <= 2) score += 3
      else if (diff <= 5) score += 1
      else if (diff > 15) score -= 5
    }
    score += TIMING_WEIGHT[String(hit.timing_type || '').toLowerCase()] ?? 0
    return { hit, score: score - index * 0.1 }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].score > -1 ? scored[0].hit : null
}

/** Which recording this is, without fetching its words. */
async function identify(query, ctx = {}) {
  const params = query.isrc
    ? { isrc: query.isrc }
    : {
        track: query.searchTitle || query.title,
        artist: query.searchArtist || query.artist,
        // No album: catalogues file the same recording under a compilation,
        // a deluxe edition or a localized name, and a mismatch empties the search.
        duration: query.duration ? Math.round(query.duration) : undefined,
      }
  const body = await getJson(withQuery(BASE, params), { signal: ctx.signal, timeoutMs: 5000 })
  return pick(body?.results, query)
}

async function fetch(query, ctx = {}) {
  const hit = ctx.hit || await identify(query, ctx)
  if (!hit?.lyricsUrl) return null
  const ttml = await getText(hit.lyricsUrl, { signal: ctx.signal, headers: { Accept: 'application/ttml+xml, text/xml, */*' } })
  if (!ttml) return null
  return { raw: ttml, isrc: hit.isrc || null }
}

module.exports = { fetch, identify }
