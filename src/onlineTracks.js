// Helpers for online songs (YouTube Music), which live in the library as
// ghost tracks: ghost://youtube/online/<videoId>, or any ghost track whose
// source link is a YouTube video (e.g. an imported playlist entry).

import { api } from './api'

/** A placeholder track with no file (imported or online). */
export function isGhostTrack(track) {
  return String(track?.file_path || '').startsWith('ghost://')
}

/** The YouTube video a ghost track can be streamed from, or null. */
export function streamVideoId(track) {
  const path = String(track?.file_path || '')
  const own = path.match(/^ghost:\/\/youtube\/online\/([\w-]{11})$/)
  if (own) return own[1]
  if (!path.startsWith('ghost://')) return null
  const m = String(track?.source_url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([\w-]{11})/)
  return m ? m[1] : null
}

/** Streamed from YouTube rather than played from a file. */
export function isStreamed(track) {
  return !!streamVideoId(track)
}

/** Can the player play it: a file, or a ghost that can be streamed. */
export function isPlayable(track) {
  return !!track && (!isGhostTrack(track) || isStreamed(track))
}

/** Cover to show for a track: its artwork file, or an online song's remote cover. */
export function trackArtURL(track) {
  if (!track) return null
  if (track.artwork_path) return api.isElectron ? `file://${track.artwork_path}` : api.artworkURL(track.id)
  return track.artwork_url || null
}

/** Where the player gets the audio: the file, or the stream of an online song; null if neither. */
export function audioSrcFor(track) {
  if (!track?.file_path) return null
  const videoId = streamVideoId(track)
  if (videoId) return api.onlineStreamURL(videoId)
  if (isGhostTrack(track)) return null
  return api.isElectron
    ? `file://${track.file_path.replace(/\\/g, '/').split('/').map(s => encodeURIComponent(s)).join('/').replace(/%3A/g, ':')}`
    : api.streamURL(track)
}

/**
 * Save a streamed song to the library with the usual downloader. Once the
 * file is in, it takes the ghost track's place in playlists, likes and history.
 */
export function saveToLibrary(track) {
  const videoId = streamVideoId(track)
  if (!videoId) return Promise.resolve({ error: 'Not a streamed song' })
  return api.downloadYT(`https://music.youtube.com/watch?v=${videoId}`, {
    title: [track.artist, track.title].filter(Boolean).join(' - ') || undefined,
    thumbnail: track.artwork_url || undefined,
    from: 'Streaming',
    replaceTrackId: isGhostTrack(track) ? track.id : undefined,
  })
}
