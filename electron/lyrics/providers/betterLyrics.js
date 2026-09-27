// BetterLyrics (the backend behind the BetterLyrics browser extension):
// Apple Music TTML keyed on title/artist/duration, plus a "Portato" endpoint
// serving QQ Music karaoke timings.
//
// Note: the host now asks for an API key on tracks it has not cached yet, so
// it only answers for songs someone has looked up before. That is fine as one
// source among several -- a miss simply falls through to the next.

const { getText, withQuery } = require('../http')

const BASE = 'https://lyrics-api.boidu.dev/getLyrics'
const PORTATO = 'https://lyrics-api.boidu.dev/qq/getLyrics'

async function fetchFrom(endpoint, query, ctx = {}) {
  const url = withQuery(endpoint, {
    s: query.searchTitle || query.title,
    a: query.searchArtist || query.artist,
    d: query.duration ? Math.round(query.duration) : undefined,
    al: query.album,
  })
  const body = await getText(url, { signal: ctx.signal })
  if (!body || /"error"\s*:/.test(body.slice(0, 200))) return null
  return { raw: body }
}

module.exports = {
  fetch: (query, ctx) => fetchFrom(BASE, query, ctx),
  fetchPortato: (query, ctx) => fetchFrom(PORTATO, query, ctx),
}
