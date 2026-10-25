// Catalogue-only Global Search. Public iTunes metadata is deliberately
// separate from streaming: user-configured playback sources resolve the audio.
const ENDPOINT = 'https://itunes.apple.com/search'
const TTL_MS = 5 * 60 * 1000
const MAX_CACHE = 80
const cache = new Map()
const safeCountry = value => /^[A-Za-z]{2}$/.test(String(value || '')) ? String(value).toUpperCase() : 'US'
// Keep Apple's known-valid thumbnail; the UI upgrades the CDN dimensions
// before attempting to display it and falls back to this original on failure.
const art = value => typeof value === 'string' && /^https:\/\//.test(value) ? value : ''

/** Validates rows without confusing Apple catalogue IDs for playback IDs. */
function normalise(kind, rows) {
  const keys = new Set()
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue
    const id = kind === 'tracks' ? row.trackId : kind === 'albums' ? row.collectionId : row.artistId
    const title = kind === 'tracks' ? row.trackName : kind === 'albums' ? row.collectionName : row.artistName
    if (id == null || !String(title || '').trim() || keys.has(String(id))) continue
    // Global music results should not contain video or podcast snippets.
    if (kind === 'tracks' && row.kind && row.kind !== 'song') continue
    if (kind !== 'artists' && !String(row.artistName || '').trim()) continue
    keys.add(String(id))
    out.push({
      id: String(id), title: String(title).trim(),
      artist: String(row.artistName || '').trim(),
      ...(row.collectionName ? { album: String(row.collectionName) } : {}),
      ...(kind === 'tracks' && Number(row.trackTimeMillis) > 0 ? { duration: Number(row.trackTimeMillis) / 1000 } : {}),
      artwork_url: art(row.artworkUrl100 || row.artworkUrl60 || row.artworkUrl30),
      ...(row.trackViewUrl || row.collectionViewUrl || row.artistViewUrl ? {
        catalogue_url: row.trackViewUrl || row.collectionViewUrl || row.artistViewUrl,
      } : {}),
      catalogue: 'apple', catalogue_id: String(id),
    })
  }
  return out
}

async function globalSearch(query, { country = 'US', offset = 0, limit = 25, fetchImpl = fetch, now = Date.now } = {}) {
  const term = String(query || '').trim().slice(0, 160)
  if (term.length < 2) return { tracks: [], albums: [], artists: [] }
  const sf = safeCountry(country)
  const start = Math.max(0, Math.min(200, Number(offset) || 0))
  const size = Math.max(1, Math.min(50, Number(limit) || 25))
  const key = JSON.stringify([term.toLowerCase(), sf, start, size])
  const hit = cache.get(key)
  if (hit && hit.expires > now()) return hit.value
  // Apple search has no cursor. Offset is a bounded client-side window over
  // a larger result batch, not an undocumented iTunes API query parameter.
  const entries = [
    ['tracks', 'song', size + start],
    ['albums', 'album', 12],
    ['artists', 'musicArtist', 12],
  ]
  const values = await Promise.allSettled(entries.map(async ([name, entity, count]) => {
    const url = new URL(ENDPOINT)
    url.search = new URLSearchParams({ term, media: 'music', entity, country: sf, limit: String(Math.min(200, count)) }).toString()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 9000)
    try {
      const response = await fetchImpl(url.toString(), { signal: controller.signal, headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error('Catalogue search unavailable (HTTP ' + response.status + ').')
      const data = await response.json()
      const rows = normalise(name, data.results)
      return [name, name === 'tracks' ? rows.slice(start, start + size) : rows]
    } finally { clearTimeout(timer) }
  }))
  if (values.every(entry => entry.status === 'rejected')) {
    throw new Error('Global catalogue unavailable. Try again.')
  }
  const value = { tracks: [], albums: [], artists: [] }
  for (const entry of values) {
    if (entry.status === 'fulfilled') {
      const [name, rows] = entry.value
      value[name] = rows
    }
  }
  cache.set(key, { expires: now() + TTL_MS, value })
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value)
  return value
}

const spotifyCache = new Map()
/** Global's catalogue selection does not modify user playback source order.
 * Inject spotifySearch in tests so no browser cookie/token flow is required. */
async function preferredGlobalSearch(query, {
  source = 'apple', rawCookie = '', spotifySearch, ...options
} = {}) {
  if (source === 'spotify') {
    try {
      if (!rawCookie) throw new Error('Spotify is not connected.')
      const crypto = require('node:crypto')
      const key = JSON.stringify([crypto.createHash('sha256').update(rawCookie).digest('hex'),
        String(query || '').trim().toLowerCase(), options.offset || 0, options.limit || 25])
      const cached = spotifyCache.get(key)
      if (cached && Date.now() < cached.until)
        return { ...cached.result, catalogue: 'spotify' }
      const request = spotifySearch || require('../artwork/spotify').catalogueSearch
      const result = await request(rawCookie, query, options)
      if (!result || !Array.isArray(result.tracks))
        throw new Error('Invalid Spotify catalogue response.')
      spotifyCache.set(key, { until: Date.now() + 2 * 60 * 1000, result })
      while (spotifyCache.size > 75) spotifyCache.delete(spotifyCache.keys().next().value)
      return { ...result, catalogue: 'spotify' }
    } catch (error) {
      // A stale sp_dc or unsupported web-token operation is a search
      // problem, not a reason to break playback or expose credentials.
      const apple = await globalSearch(query, options)
      return { ...apple, catalogue: 'apple', fallback: true,
        notice: 'Spotify search is unavailable. Showing Apple Music results.' }
    }
  }
  return { ...await globalSearch(query, options), catalogue: 'apple' }
}

module.exports = { globalSearch, preferredGlobalSearch, normalise }
