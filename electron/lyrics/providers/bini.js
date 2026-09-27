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

const BASE = 'https://lyrics-api.binimum.org/'

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function pick(results, query) {
  if (!Array.isArray(results) || !results.length) return null
  const duration = Number(query.duration) || 0
  const wantTitle = normalize(query.searchTitle || query.title)
  const scored = results.map((hit, index) => {
    let score = 0
    const title = normalize(hit.track_name)
    if (title === wantTitle) score += 4
    else if (title.startsWith(wantTitle) || wantTitle.startsWith(title)) score += 2
    if (duration > 0 && hit.duration) {
      const diff = Math.abs(hit.duration - duration)
      if (diff <= 2) score += 3
      else if (diff <= 5) score += 1
      else if (diff > 15) score -= 5
    }
    if (String(hit.timing_type).toLowerCase() === 'word') score += 1
    return { hit, score: score - index * 0.1 }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].score > -3 ? scored[0].hit : null
}

/** Which recording this is, without fetching its words. */
async function identify(query, ctx = {}) {
  const params = query.isrc
    ? { isrc: query.isrc }
    : {
        track: query.searchTitle || query.title,
        artist: query.searchArtist || query.artist,
        album: query.album,
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
