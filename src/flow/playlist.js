import { isGhostTrack, streamRef, sourceRefKey } from '../onlineTracks.js'
import { songKey } from '../recommendations.js'

/**
 * Flow playlists store DB song identities (including durable ghost tracks),
 * NEVER stream URLs. onlineSave has already created a playable ghost row for
 * recommendations, with an immutable provider ID and artwork metadata.
 */
export function flowPlaylistTracks(tracks) {
  const used = new Set()
  const recordings = new Set()
  const saved = []
  for (const track of tracks || []) {
    if (!track?.id || !track?.title || !track?.artist) continue
    const stream = streamRef(track)
    if (isGhostTrack(track) && !stream) continue
    // A temporary direct URL is not a portable recording.
    if (/^https?:\/\//.test(String(track.file_path || '')) && !stream) continue
    const id = sourceRefKey(stream) || track.id
    const recording = songKey(track)
    if (used.has(id) || recordings.has(recording)) continue
    used.add(id)
    recordings.add(recording)
    saved.push(track)
  }
  return saved
}
