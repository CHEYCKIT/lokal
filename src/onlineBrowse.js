// Album and artist pages for music that isn't in the library: the songs
// playing from YouTube, SoundCloud or an addon. Their album and artist
// shortcuts open these instead of the library's pages (which have nothing
// for them). The songs come from the catalogue (YouTube Music, Last.fm, then
// a search of the playback sources) and are found in the playback sources
// when they're played or downloaded, like Home's recommendations.

import { api } from './api.js'
import { loadDiscoveryCatalogue } from './discoveryCatalogue.js'
import { isGhostTrack, streamRef } from './onlineTracks.js'
import { playbackSources, recommendationKey, recommendationMatch, timed } from './recommendations.js'

/** "/online/album?artist=...&album=..." */
export function onlineAlbumPath({ artist, album, albumId, provider, sourceAlbumId } = {}) {
  const params = new URLSearchParams({ artist: String(artist || ''), album: String(album || '') })
  if (/^MPRE[\w-]+$/.test(String(albumId || ''))) params.set('albumId', albumId)
  // An addon's album: from that addon ("source"), by its id when known.
  if (/^a-[0-9a-f]{10}$/.test(String(provider || ''))) {
    params.set('source', provider)
    if (sourceAlbumId) params.set('sourceAlbum', String(sourceAlbumId))
  }
  return `/online/album?${params}`
}

/** The album page of a song: its addon's when it plays from one. */
export function trackAlbumPath(track) {
  const ref = streamRef(track)
  const provider = /^a-/.test(ref?.provider || '') ? ref.provider : /^a-/.test(track.provider || '') ? track.provider : null
  return onlineAlbumPath({
    artist: track.album_artist || track.artist, album: track.album, albumId: track.albumId,
    provider, sourceAlbumId: provider && track.provider === provider ? track.albumId : null,
  })
}

// ---------------------------------------------------------------- addons' own album and artist pages

/** Enabled addons offering `resource` ("album" / "artist"), `first` before the others, then in playback order. */
export async function catalogueAddons(resource, client = api, first = null) {
  const providers = await Promise.resolve(client.onlineProviders?.()).catch(() => [])
  const offering = (Array.isArray(providers) ? providers : []).filter(item => item?.addon && item[resource])
  if (!offering.length) return []
  const order = (await playbackSources(client).catch(() => [])).map(source => source.id)
  const rank = id => (id === first ? -1 : order.includes(id) ? order.indexOf(id) : order.length)
  return offering.map(item => item.id).sort((a, b) => rank(a) - rank(b))
}

const plain = value => recommendationKey(value)

/** The addon's own result for `track` (with its album and artist ids), by searching it. */
async function addonResultFor(track, provider, client) {
  const ref = streamRef(track) || (track.provider && track.id ? { provider: track.provider, id: track.id } : null)
  const response = await timed(() => client.onlineSearch(`${track.artist} ${track.title}`, provider), 12000).catch(() => null)
  const results = Array.isArray(response?.results) ? response.results : []
  return (ref?.provider === provider && results.find(result => String(result.id) === String(ref.id))) || recommendationMatch(track, results)
}

/** Songs from an addon album or artist page: played from that addon directly (no search). */
const exactTracks = (tracks, artwork = '') => tracks.map(track => ({ ...track, exact: true, artwork_url: track.thumbnail || artwork || '' }))

/**
 * An album from an addon that has album pages: { tracks, title, artist,
 * artwork, provider, albumId } or null. Its id: given, else from a song of
 * it (`anchor`), else by searching the addon for the artist and album.
 */
export async function loadAddonAlbum({ artist, album, provider, sourceAlbumId, anchor }, client = api) {
  for (const addon of await catalogueAddons('album', client, provider)) {
    let id = addon === provider ? sourceAlbumId : null
    if (!id && anchor?.title) id = (await addonResultFor({ artist, ...anchor }, addon, client))?.albumId
    if (!id) {
      const response = await timed(() => client.onlineSearch(`${artist} ${album}`, addon), 12000).catch(() => null)
      const results = Array.isArray(response?.results) ? response.results : []
      const sameArtist = result => [result.artist, ...(result.artists || [])].some(name => plain(name) === plain(artist))
      id = results.find(result => result.albumId && releaseTitleKey(result.album) === releaseTitleKey(album) && sameArtist(result))?.albumId
    }
    if (!id) continue
    const result = await timed(() => client.addonAlbum(addon, id), 15000).catch(() => null)
    if (!result || result.error || !result.tracks?.length) continue
    return { tracks: exactTracks(result.tracks, result.artwork_url), title: result.title || album, artist: result.artist || artist, artwork: result.artwork_url || '', year: result.year, provider: addon, albumId: result.id }
  }
  return null
}

/**
 * An artist from an addon that has artist pages: { name, image, tracks,
 * albums } or null. Their id tells them from namesakes: the one credited on
 * `anchor` (a song of theirs), else of the artists so named in the addon's
 * search the one sharing the most with `hints` (the library's titles), else
 * the one most of the results credit.
 */
export async function loadAddonArtist(name, { anchor, hints = [] } = {}, client = api) {
  const want = plain(name)
  const hinted = new Set(hints.map(plain).filter(Boolean))
  for (const addon of await catalogueAddons('artist', client, anchor?.provider)) {
    let id = null
    if (anchor?.title) {
      const own = await addonResultFor({ artist: name, ...anchor }, addon, client)
      const at = (own?.artists || []).findIndex(artist => plain(artist) === want)
      id = own?.artistIds?.[at >= 0 ? at : 0] || null
    }
    if (!id) {
      const response = await timed(() => client.onlineSearch(name, addon), 12000).catch(() => null)
      const tally = new Map() // id -> { count, hints }
      for (const result of Array.isArray(response?.results) ? response.results : []) {
        ;(result.artists || []).forEach((artist, index) => {
          const artistId = result.artistIds?.[index]
          if (!artistId || plain(artist) !== want) return
          const entry = tally.get(artistId) || { count: 0, hints: 0 }
          entry.count++
          if (hinted.has(plain(result.title)) || hinted.has(plain(result.album))) entry.hints++
          tally.set(artistId, entry)
        })
      }
      id = [...tally.entries()].sort((a, b) => b[1].hints - a[1].hints || b[1].count - a[1].count)[0]?.[0] || null
    }
    if (!id) continue
    const result = await timed(() => client.addonArtist(addon, id), 15000).catch(() => null)
    if (!result || result.error || (!result.tracks?.length && !result.albums?.length)) continue
    return { name: result.name || name, image: result.image || '', tracks: exactTracks(result.tracks), albums: result.albums.map(item => ({ ...item, provider: addon, sourceAlbumId: item.albumId, albumId: null })) }
  }
  return null
}

/** A song that isn't a library file: streamed, or a ghost row. */
export const isOnlineTrack = track => !!track && (isGhostTrack(track) || !track.file_path)

/** The library's copies of an album, if it has any songs of it as files. */
export async function libraryAlbum({ artist, album }, client = api) {
  if (!album) return null
  const tracks = await Promise.resolve(client.getAlbumTracks({ title: album, album_artist: artist })).catch(() => [])
  return (Array.isArray(tracks) ? tracks : []).some(track => track?.file_path && !isGhostTrack(track)) ? { title: album, album_artist: artist } : null
}

/** An album's songs, in order: { tracks, error } */
export async function loadOnlineAlbum({ artist, album, albumId, artwork, provider, sourceAlbumId, anchor }, client = api, options = {}) {
  // The catalogues first (Last.fm, YouTube Music); then an addon with album
  // pages (the whole album, in order); then a search of the playback sources.
  let result = await loadDiscoveryCatalogue({ type: 'album', artist, album, albumId }, client, { ...options, searchSources: false })
  if (!result.tracks?.length) {
    const fromAddon = await loadAddonAlbum({ artist, album, provider, sourceAlbumId, anchor }, client).catch(() => null)
    if (fromAddon) return { tracks: fromAddon.tracks, error: '', provider: fromAddon.provider, artwork: fromAddon.artwork }
    result = await loadDiscoveryCatalogue({ type: 'album', artist, album, albumId }, client, { ...options, skipSources: ['lastfm', 'youtube'] })
  }
  // Songs without their own cover show the album's.
  const tracks = (result.tracks || []).map(track => ({ ...track, album: track.album || album, artwork_url: track.artwork_url || track.thumbnail || artwork || '' }))
  return { tracks, error: tracks.length ? '' : result.error }
}

/** An artist's popular songs: { tracks, error } */
export async function loadOnlineArtistSongs(artist, client = api, options = {}) {
  const result = await loadDiscoveryCatalogue({ type: 'artist', artist }, client, { searchSources: true, ...options })
  return { tracks: (result.tracks || []).map(track => ({ ...track, artwork_url: track.artwork_url || track.thumbnail || '' })), error: result.error || '' }
}

/**
 * One artist's songs and releases from their YouTube Music channel, so a
 * namesake's music isn't mixed in. `anchor`: a song of theirs (the one
 * playing) to find the channel by; `hints`: the library's titles by them.
 * { name, tracks, albums } or null (no channel found: search by name instead).
 */
export async function loadArtistChannel(artist, { anchor, hints = [] } = {}, client = api, { timeoutMs = 20000 } = {}) {
  const result = await timed(() => client.discoveryCatalogue({ source: 'youtube', type: 'artistPage', artist, anchor, hints: hints.slice(0, 80) }), timeoutMs).catch(() => null)
  if (!result || result.error || (!result.tracks?.length && !result.albums?.length)) return null
  const tracks = result.tracks.map(track => ({ ...track, source: 'youtube', artwork_url: track.artwork_url || track.thumbnail || '' }))
  const albums = [...(result.albums || [])]
  const known = new Set(albums.map(album => releaseTitleKey(album.title)))
  for (const track of tracks) {
    if (track.album && !known.has(releaseTitleKey(track.album))) {
      known.add(releaseTitleKey(track.album))
      albums.push({ title: track.album, artist: result.name || artist, albumId: track.albumId, artwork_url: track.artwork_url })
    }
  }
  return { name: result.name || artist, image: result.image || '', tracks, albums }
}

/**
 * An artist's albums: from YouTube Music or Last.fm, plus the albums of
 * `songs` (so a source that only searches songs still gives some).
 */
export async function loadOnlineArtistAlbums(artist, songs = [], client = api, { timeoutMs = 12000 } = {}) {
  const albums = []
  for (const source of ['youtube', 'lastfm']) {
    const result = await timed(() => client.discoveryCatalogue({ type: 'albums', artist, source }), timeoutMs).catch(() => null)
    if (Array.isArray(result?.albums) && result.albums.length) { albums.push(...result.albums); break }
  }
  for (const song of songs) {
    if (song?.album) albums.push({ title: song.album, artist: song.album_artist || artist, artwork_url: song.artwork_url || song.thumbnail || '' })
  }
  const seen = new Map()
  for (const album of albums) {
    const key = recommendationKey(album.title)
    if (!key) continue
    const known = seen.get(key)
    if (!known) seen.set(key, { ...album })
    else if (!known.artwork_url && album.artwork_url) known.artwork_url = album.artwork_url
  }
  return [...seen.values()]
}

/** A release title to compare by: "I Am (Expanded Edition)" -> "i am". */
export const releaseTitleKey = title => recommendationKey(String(title || '').replace(/\s*[([][^)\]]*[)\]]/g, '')) || recommendationKey(title)

/**
 * The online tracklist with the library's songs in it: each online song the
 * library has is replaced by the library's copy (which plays the file); the
 * rest stay online. Library songs the online list doesn't have (bonus tracks)
 * come last. { tracks, missing, owned }
 */
export function mergeWithLibrary(onlineTracks = [], libraryTracks = []) {
  const local = (libraryTracks || []).filter(track => track?.file_path && !isGhostTrack(track))
  const used = new Set()
  const tracks = (onlineTracks || []).map(track => {
    const free = local.filter(item => !used.has(item))
    const own = recommendationMatch(track, free) || free.find(item => recommendationMatch(item, [track]))
    if (!own) return track
    used.add(own)
    return own
  })
  const extras = local.filter(item => !used.has(item))
  return {
    tracks: [...tracks, ...extras],
    missing: tracks.filter(track => isOnlineTrack(track)),
    owned: used.size + extras.length,
  }
}

// Which albums and artists are shown with their online songs (the "Full album
// online" / "More online" switches), remembered on this computer.
const CONNECTED_KEY = 'lokal-online-connected'
function connectedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(CONNECTED_KEY) || '[]')) } catch { return new Set() }
}
export function isConnected(key) {
  return !!key && connectedSet().has(key)
}
export function setConnected(key, on) {
  if (!key) return
  const set = connectedSet()
  if (on) set.add(key)
  else set.delete(key)
  try { localStorage.setItem(CONNECTED_KEY, JSON.stringify([...set].slice(-500))) } catch {}
}

// ---------------------------------------------------------------- cache

// Online album and artist data, kept once loaded: coming back to a page (or
// opening it again later) shows it at once instead of looking it all up
// again. Refresh buttons load it anew. In memory, and in localStorage for a
// week (the newest 80); failed or empty lookups aren't kept.
const CACHE_KEY = 'lokal-online-cache-v1'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CACHE_MAX = 80
let memory = null

function cacheEntries() {
  if (memory) return memory
  memory = new Map()
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')
    for (const [key, entry] of Array.isArray(saved) ? saved : []) {
      if (entry && Date.now() - entry.at < CACHE_TTL_MS) memory.set(key, entry)
    }
  } catch {}
  return memory
}

function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify([...cacheEntries()].slice(-CACHE_MAX))) } catch {}
}

const cacheKeyOf = (kind, parts) => `${kind}:${parts.map(part => recommendationKey(part) || String(part || '')).join('|')}`

/** The key an online album is cached under. */
export const albumCacheKey = ({ artist, album, albumId, provider, sourceAlbumId } = {}) => cacheKeyOf('album', [artist, album, albumId, provider, sourceAlbumId])
/** The key an online artist is cached under. */
export const artistCacheKey = name => cacheKeyOf('artist', [name])

/** What's cached under `key` (and when), or null. */
export function peekOnline(key) {
  const entry = cacheEntries().get(key)
  if (!entry || Date.now() - entry.at >= CACHE_TTL_MS) return null
  return entry
}

/** Keep `value` under `key` (newest last). */
export function keepOnline(key, value) {
  const entries = cacheEntries()
  entries.delete(key)
  entries.set(key, { at: Date.now(), value })
  while (entries.size > CACHE_MAX) entries.delete(entries.keys().next().value)
  saveCache()
}

/**
 * The cached value of `key`, else `load()`'s (kept when `keep(value)` says it
 * found something). `refresh` loads it anew.
 */
export async function cachedOnline(key, load, { refresh = false, keep = () => true } = {}) {
  if (!refresh) {
    const hit = peekOnline(key)
    if (hit) return hit.value
  }
  const value = await load()
  if (value && keep(value)) keepOnline(key, value)
  return value
}

/** An album's songs (loadOnlineAlbum), from the cache when it has them. */
export function loadOnlineAlbumCached(options, client = api, loadOptions = {}, { refresh = false } = {}) {
  return cachedOnline(albumCacheKey(options), () => loadOnlineAlbum(options, client, loadOptions), { refresh, keep: result => result.tracks?.length > 0 })
}
