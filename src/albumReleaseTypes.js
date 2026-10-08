import { api } from './api.js'
import { loadOnlineArtistAlbums, releaseTitleKey } from './onlineBrowse.js'
import { loadDiscoveryCatalogue } from './discoveryCatalogue.js'
import { recommendationKey } from './recommendations.js'

const CACHE_KEY = 'lokal-library-release-types-v1'
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000

const KNOWN = new Set(['album', 'ep', 'single', 'compilation', 'live'])

function normalizeType(value) {
  const type = String(value || '').toLowerCase()
  return KNOWN.has(type) ? type : null
}

function keyFor(album) {
  const artist = recommendationKey(album?.album_artist || album?.artists || '')
  const title = releaseTitleKey(album?.title || '')
  return artist && title ? `${artist}|${title}` : ''
}

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function writeCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch {}
}

function cachedEntry(cache, key) {
  const entry = cache[key]
  if (!entry || !Number.isFinite(Number(entry.checkedAt))) return null
  const age = Date.now() - Number(entry.checkedAt)
  const ttl = entry.type ? CACHE_TTL_MS : NEGATIVE_TTL_MS
  return age >= 0 && age < ttl ? entry : null
}

function saveResolved(cache, key, type) {
  cache[key] = { type: normalizeType(type), checkedAt: Date.now() }
}

/** Apply classifications already known locally without contacting a catalogue. */
export function applyCachedReleaseTypes(albums = []) {
  const cache = readCache()
  return albums.map(album => {
    const type = normalizeType(cache[keyFor(album)]?.type)
    return type && Number(album?.track_count || 0) <= 1
      ? { ...album, release_type: type, release_type_source: 'online' }
      : album
  })
}

function sameArtist(left, right) {
  const a = recommendationKey(left || '')
  const b = recommendationKey(right || '')
  return !!a && !!b && (a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `))
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0

  const run = async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

async function exactCatalogueType(album, client, isCurrent) {
  const result = await loadDiscoveryCatalogue(
    { type: 'album', artist: album.album_artist || album.artists || '', album: album.title },
    client,
    { searchSources: false, isCurrent, timeoutMs: 9000 },
  )
  if (!isCurrent()) return null

  const tracks = Array.isArray(result?.tracks) ? result.tracks : []
  if (!tracks.length) return null

  if (tracks.length <= 1) return 'single'
  if (tracks.length <= 6) return 'ep'
  return 'album'
}

/**
 * Resolve the library's one-file "albums" against online release metadata.
 * The local track count is only a fallback; an album remains an Album even
 * when the library contains only one of its songs.
 */
export async function resolveLibraryReleaseTypes(albums = [], client = api, { refresh = false, isCurrent = () => true, onProgress } = {}) {
  if (!Array.isArray(albums) || !albums.length || !isCurrent()) return albums

  const candidates = [...new Map(albums
    .filter(album => Number(album?.track_count || 0) <= 1 && keyFor(album))
    .map(album => [keyFor(album), album])).values()]
  if (!candidates.length) return albums

  const cache = readCache()

  const resolved = new Map()
  const pending = []
  for (const album of candidates) {
    const key = keyFor(album)
    const hit = cachedEntry(cache, key)
    if (!refresh && hit) {
      if (hit.type) resolved.set(key, hit.type)
    } else {
      pending.push(album)
    }
  }

  let done = refresh ? 0 : candidates.length - pending.length
  let matched = refresh ? 0 : resolved.size
  let failed = 0
  const report = (current = '') => onProgress?.({ done, total: candidates.length, matched, failed, current })
  const complete = (album, type) => {
    if (!isCurrent()) return
    const key = keyFor(album)
    if (type) {
      resolved.set(key, type)
      saveResolved(cache, key, type)
      matched++
    } else {
      if (!cache[key]?.type) saveResolved(cache, key, null)
      failed++
    }
    done++
    writeCache(cache)
    report(album.title)
  }
  report()

  // Prefer the artist release catalogue: one lookup can classify many local
  // one-track releases and YouTube Music already provides Album/EP/Single.
  const byArtist = new Map()
  for (const album of pending) {
    const artist = String(album.album_artist || album.artists || '').trim()
    const artistKey = recommendationKey(artist)
    if (!artistKey) continue
    const group = byArtist.get(artistKey) || { artist, albums: [] }
    group.albums.push(album)
    byArtist.set(artistKey, group)
  }

  const unresolved = []
  await mapLimit([...byArtist.values()], 4, async group => {
    if (!isCurrent()) return
    const releases = await loadOnlineArtistAlbums(group.artist, group.albums, client).catch(() => [])
    if (!isCurrent()) return
    const remaining = []
    for (const album of group.albums) {
      const match = (releases || []).find(release => (
        releaseTitleKey(release?.title) === releaseTitleKey(album.title) &&
        (!release?.artist || sameArtist(release.artist, group.artist))
      ))
      const type = normalizeType(match?.release_type)
      if (type) {
        complete(album, type)
      } else {
        remaining.push(album)
      }
    }
    unresolved.push(...remaining)
  })

  // Artist release shelves are capped, or a provider may not expose release
  // types at all. Resolve misses through the exact album catalogue lookup.
  await mapLimit(unresolved, 4, async album => {
    if (!isCurrent()) return
    const type = await exactCatalogueType(album, client, isCurrent).catch(() => null)
    complete(album, type)
  })

  return applyCachedReleaseTypes(albums)
}

export function clearLibraryReleaseTypeCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch {}
}
