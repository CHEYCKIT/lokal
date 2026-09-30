// What a selection of songs can be sent to: the queue, a playlist. Shared by
// the song lists, the album page and the albums grid.

import { usePlayerStore, useAppStore } from './store/player'
import { showToast } from './components/Toaster'
import { plural } from './plural'
import { isGhostTrack, isPlayable } from './onlineTracks'

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
