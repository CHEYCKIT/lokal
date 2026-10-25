// Catalogue-only Global Search. Public iTunes metadata is deliberately
// separate from streaming: user-configured playback sources resolve the audio.
const ENDPOINT = 'https://itunes.apple.com/search'
const TTL_MS = 5 * 60 * 1000
const MAX_CACHE = 80
const cache = new Map()
const safeCountry = value => /^[A-Za-z]{2}$/.test(String(value || '')) ? String(value).toUpperCase() : 'US'
const art = value => typeof value === 'string' && /^https:\/\//.test(value)
  ? value.replace(/\/\d{2,4}x\d{2,4}bb\./, '/1200x1200bb.') : ''

/** Validates rows without confusing Apple catalogue IDs for playback IDs. */
function normalise(kind, rows) {
  const keys = new Set()
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue
    const id = kind === 'tracks' ? row.trackId : kind === 'albums' ? row.collectionId : row.artistId
    const title = kind === 'tracks' ? row.trackName : kind === 'albums' ? row.collectionName : row.artistName
    if (id == null || !String(title || '').trim() || keys.has(String(id))) continue
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
  const values = await Promise.all(entries.map(async ([name, entity, count]) => {
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
  const value = Object.fromEntries(values)
  cache.set(key, { expires: now() + TTL_MS, value })
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value)
  return value
}
module.exports = { globalSearch, normalise }
