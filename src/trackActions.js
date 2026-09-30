// What a selection of songs can be sent to: the queue, a playlist, a new
// playlist. Shared by the song lists, the album page, the albums grid, Home's
// mixes and suggestions, and the recap.

import { usePlayerStore, useAppStore } from './store/player'
import { showToast } from './components/Toaster'
import { plural } from './plural'
import { isGhostTrack, isPlayable } from './onlineTracks'
import { api } from './api'

// Import placeholders can't be played; streamed songs can.
const isPlaceholder = (track) => !track?.id || !isPlayable(track)

/** Songs that are in the library (not streamed or import placeholders): what can be deleted. */
export function libraryTracks(tracks) {
  return (tracks || []).filter(track => track?.id && !isGhostTrack(track))
}

/** Right after the current song, in the order given (one by one, they'd end up reversed). */
export function playNextMany(tracks) {
  const list = (tracks || []).filter(track => !isPlaceholder(track))
  if (!list.length) return
  const { playNext } = usePlayerStore.getState()
  for (let i = list.length - 1; i >= 0; i -= 1) playNext(list[i])
  showToast(list.length === 1 ? `Playing next: ${list[0].title || 'Unknown track'}` : `${plural(list.length, 'track')} will play next`)
}

export function addToQueueMany(tracks) {
  const list = (tracks || []).filter(track => !isPlaceholder(track))
  if (!list.length) return
  const { addToQueue } = usePlayerStore.getState()
  for (const track of list) addToQueue(track)
  showToast(list.length === 1 ? `Added to queue: ${list[0].title || 'Unknown track'}` : `Added ${plural(list.length, 'track')} to queue`)
}

export function addToPlaylistMany(tracks) {
  const list = (tracks || []).filter(track => track?.id)
  if (!list.length) return
  const { openAddToPlaylist, openAddMultipleToPlaylist } = useAppStore.getState()
  if (list.length === 1) openAddToPlaylist(list[0])
  else openAddMultipleToPlaylist(list.map(track => track.id))
}

/**
 * Save `tracks` as a new playlist called `name`, in their order.
 * @returns the playlist, or null when there was nothing to save or it failed
 */
export async function saveAsPlaylist(name, tracks, { description, userId = useAppStore.getState().user?.id } = {}) {
  const ids = [...new Set((tracks || []).map(track => track?.id).filter(Boolean))]
  if (!ids.length) return null
  const playlist = await api.createPlaylist(name, userId, description)
  if (!playlist?.id) return null
  await api.addMultipleToPlaylist(playlist.id, ids)
  window.dispatchEvent(new CustomEvent('lokal:playlists-changed', { detail: { playlistId: playlist.id, action: 'created' } }))
  return playlist
}
