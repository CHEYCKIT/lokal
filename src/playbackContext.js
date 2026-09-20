// Helpers for the "playing from ..." shortcuts (issue #16).
//
// A playback context describes *where* the current queue came from so the UI can
// offer a shortcut back to it, the way Spotify does. Contexts are kept small and
// JSON-serialisable because they are persisted alongside the queue.
//
//   { type: 'playlist', id, name }
//   { type: 'album',    name, album: { title, album_artist, artwork_path } }
//   { type: 'artist',   id, name }
//   { type: 'library' | 'mix' | 'search' | 'recap', name }

export function makePlaylistContext(playlist, fallbackId = null) {
  const id = playlist?.id ?? fallbackId
  if (id === null || id === undefined || id === '') return null
  return {
    type: 'playlist',
    id: String(id),
    name: playlist?.name || (String(id) === 'liked' ? 'Liked Songs' : 'Playlist'),
  }
}

export function makeAlbumContext(album) {
  const title = album?.title || album?.album
  if (!title) return null
  return {
    type: 'album',
    name: title,
    album: {
      title,
      album_artist: album?.album_artist || album?.artists || null,
      artwork_path: album?.artwork_path || null,
    },
  }
}

export function makeArtistContext(artistId, artistName) {
  if (!artistId) return null
  return { type: 'artist', id: String(artistId), name: artistName || 'Artist' }
}

/** Build an album context straight from a track's own tags. */
export function albumContextFromTrack(track) {
  if (!track?.album) return null
  return makeAlbumContext({
    title: track.album,
    album_artist: track.album_artist || track.artist,
    artwork_path: track.artwork_path,
  })
}

const TYPE_LABELS = {
  playlist: 'Playing from playlist',
  album: 'Playing from album',
  artist: 'Playing from artist',
  mix: 'Playing from mix',
  library: 'Playing from library',
  search: 'Playing from search',
  recap: 'Playing from recap',
}

export function contextLabel(context) {
  if (!context?.name) return null
  return TYPE_LABELS[context.type] || 'Playing from'
}

/** Whether clicking the context can actually take the user somewhere. */
export function isContextNavigable(context) {
  if (!context) return false
  if (context.type === 'playlist') return !!context.id
  if (context.type === 'artist') return !!context.id
  if (context.type === 'album') return !!context.album?.title
  return false
}

/**
 * Navigate to the source of the current queue.
 * `highlightTrackId` lets the destination scroll to and flash the playing track.
 */
export function navigateToContext(nav, context, highlightTrackId = null) {
  if (!nav || !isContextNavigable(context)) return false
  const state = highlightTrackId ? { highlightTrackId } : {}

  if (context.type === 'playlist') {
    nav(`/playlist/${context.id}`, { state })
    return true
  }
  if (context.type === 'artist') {
    nav(`/artist/${context.id}`, { state })
    return true
  }
  if (context.type === 'album') {
    nav('/albums', { state: { ...state, album: context.album } })
    return true
  }
  return false
}

/** Navigate to the album page for a single track (bottom-bar title shortcut). */
export function navigateToTrackAlbum(nav, track) {
  const context = albumContextFromTrack(track)
  if (!nav || !context) return false
  nav('/albums', { state: { album: context.album, highlightTrackId: track?.id || null } })
  return true
}
