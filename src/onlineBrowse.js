// Album and artist pages for music that isn't in the library: the songs
// playing from YouTube, SoundCloud or an addon. Their album and artist
// shortcuts open these instead of the library's pages (which have nothing
// for them). The songs come from the catalogue (YouTube Music, Last.fm, then
// a search of the playback sources) and are found in the playback sources
// when they're played or downloaded, like Home's recommendations.

import { api } from './api.js'
import { loadDiscoveryCatalogue } from './discoveryCatalogue.js'
import { isGhostTrack } from './onlineTracks.js'
import { recommendationKey, timed } from './recommendations.js'

/** "/online/album?artist=...&album=..." */
export function onlineAlbumPath({ artist, album, albumId } = {}) {
  const params = new URLSearchParams({ artist: String(artist || ''), album: String(album || '') })
  if (/^MPRE[\w-]+$/.test(String(albumId || ''))) params.set('albumId', albumId)
  return `/online/album?${params}`
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
export async function loadOnlineAlbum({ artist, album, albumId, artwork }, client = api, options = {}) {
  const result = await loadDiscoveryCatalogue({ type: 'album', artist, album, albumId }, client, options)
  // Songs without their own cover show the album's.
  const tracks = (result.tracks || []).map(track => ({ ...track, album: track.album || album, artwork_url: track.artwork_url || track.thumbnail || artwork || '' }))
  return { tracks, error: tracks.length ? '' : result.error }
}

/** An artist's popular songs: { tracks, error } */
export async function loadOnlineArtistSongs(artist, client = api, options = {}) {
  const result = await loadDiscoveryCatalogue({ type: 'artist', artist }, client, options)
  return { tracks: (result.tracks || []).map(track => ({ ...track, artwork_url: track.artwork_url || track.thumbnail || '' })), error: result.error || '' }
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
