// Wording and formatting shared by the Recap page and its story.
import { api } from './api'

const GENRE_COMMENTS = {
  'slowcore': "staring at the ceiling again, i see.",
  'lo-fi': "staying productive, or just daydreaming?",
  'techno': "we get it, you're at a warehouse rave in your head.",
  'shoegaze': "can you even hear the lyrics through all that fuzz?",
  'metal': "your neighbors probably hate you. keep it up.",
  'pop': "no thoughts, just vibes and hooks.",
  'ambient': "is this music or just background noise for your naps?",
  'default': "this was your top sound."
}

export function fmtMinutes(minutes) {
  if (!minutes) return '0 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins ? `${hours}h ${mins}m` : `${hours}h`
}

export function fmtDate(seconds) {
  if (!seconds) return ''
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtHour(hour) {
  if (hour === null || hour === undefined || Number.isNaN(Number(hour))) return 'No peak yet'
  const suffix = Number(hour) >= 12 ? 'PM' : 'AM'
  const normalized = Number(hour) % 12 || 12
  return `${normalized}:00 ${suffix}`
}

export function hourComment(hour) {
  const n = Number(hour)
  if (!Number.isFinite(n)) return "the data kept its secrets."
  if (n >= 5 && n < 8) return "early bird? or just haven't gone to bed yet?"
  if (n >= 12 && n < 14) return "the midday slump needed a soundtrack."
  if (n >= 18 && n < 21) return "the main character energy is peaking."
  if (n >= 23 || n < 4) return "ooh... late night listener are you?"
  return "this was your peak vibe hour."
}

export function sessionComment(session) {
  const label = String(session?.label || '').toLowerCase()
  if (label.includes('late night')) return "you're a certified night owl."
  if (label.includes('morning')) return "suspiciously productive behavior."
  if (label.includes('afternoon')) return "the slump hit you hard, didn't it?"
  if (label.includes('evening')) return "the library opened up when the sun went down."
  return "this session had a very specific shape."
}

/** A track's cover: its artwork file, else a streamed song's own (https) cover. */
export function trackArt(track) {
  if (track?.artwork_path) return api.isElectron ? api.fileURL(track.artwork_path) : api.artworkURL(track.id)
  return /^https:\/\//.test(String(track?.artwork_url || '')) ? track.artwork_url : ''
}

export function isFallbackGenre(genre) {
  return String(genre || '').trim().toLowerCase() === 'music'
}

export function filteredGenres(genres = []) {
  return genres.filter(genre => !isFallbackGenre(genre.genre))
}

export function genreComment(genre) {
  const key = String(genre || '').trim().toLowerCase()
  return GENRE_COMMENTS[key] || GENRE_COMMENTS['default']
}

export function daysText(minutes) {
  const days = (Number(minutes || 0) / 1440)
  if (days < 1) return "less than a day, but still very real"
  return `${days.toFixed(days >= 10 ? 0 : 1)} days of straight music`
}

export function albumArt(album, tracks = []) {
  const match = tracks.find(track => track.album === album?.album && trackArt(track))
  return trackArt(match)
}

export function artistAlbumName(artist, albums = [], tracks = []) {
  const direct = tracks.find(track => track.artist === artist?.artist && track.album)
  if (direct?.album) return direct.album
  return albums[0]?.album || 'one song'
}
