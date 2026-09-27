// LRCLIB: whole-line LRC, and almost always up. An exact /get first (title,
// artist, duration), then a /search over the same name when that misses,
// taking the synced entry closest in length.

const { getJson, withQuery } = require('../http')
const { parsePlain } = require('../lrc')

const BASE = 'https://lrclib.net/api'
const DURATION_TOLERANCE = 5

function asResult(entry) {
  if (!entry || entry.instrumental) return entry?.instrumental ? { instrumental: true } : null
  if (entry.syncedLyrics) return { raw: entry.syncedLyrics }
  if (entry.plainLyrics) return { lines: parsePlain(entry.plainLyrics) }
  return null
}

async function fetch(query, ctx = {}) {
  const title = query.searchTitle || query.title
  const artist = query.searchArtist || query.artist
  const duration = query.duration ? Math.round(query.duration) : undefined

  const exact = await getJson(withQuery(`${BASE}/get`, { track_name: title, artist_name: artist, duration }), { signal: ctx.signal })
  if (exact?.syncedLyrics || exact?.instrumental) return asResult(exact)

  const results = await getJson(withQuery(`${BASE}/search`, { track_name: title, artist_name: artist }), { signal: ctx.signal })
  if (Array.isArray(results) && results.length) {
    const near = (e) => !duration || !e.duration || Math.abs(e.duration - duration) <= DURATION_TOLERANCE
    const synced = results.filter(e => e.syncedLyrics && near(e))
      .sort((a, b) => Math.abs((a.duration || 0) - (duration || 0)) - Math.abs((b.duration || 0) - (duration || 0)))
    if (synced.length) return asResult(synced[0])
  }
  return asResult(exact) || (Array.isArray(results) ? asResult(results.find(e => e.plainLyrics)) : null)
}

module.exports = { fetch }
