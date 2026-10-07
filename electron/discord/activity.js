const GITHUB_URL = 'https://github.com/sipbuu/lokal'

function text(value, fallback) {
  const valueText = typeof value === 'string' && value.trim() ? value.trim() : fallback
  return Array.from(valueText).slice(0, 128).join('').padEnd(2, '\u200b')
}

function publicUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 512) return null
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return null
    return url
  } catch { return null }
}

function songButton(track) {
  const youtubeId = /^yt:([\w-]{11})$/.exec(track.source_ref || '')?.[1]
    || /^ghost:\/\/youtube\/online\/([\w-]{11})$/.exec(track.file_path || '')?.[1]
  if (youtubeId) return { label: 'Play on YouTube Music', url: `https://music.youtube.com/watch?v=${youtubeId}` }
  const source = publicUrl(track.source_url)
  if (source) {
    const host = source.hostname.replace(/^www\./, '')
    if (['youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
      const id = host === 'youtu.be' ? source.pathname.slice(1) : source.searchParams.get('v')
      if (/^[\w-]{11}$/.test(id || '')) return { label: 'Play on YouTube Music', url: `https://music.youtube.com/watch?v=${id}` }
    }
    if (host === 'soundcloud.com') return { label: 'Play on SoundCloud', url: `${source.origin}${source.pathname}` }
    if (host === 'open.spotify.com' && /^\/track\/[\w]+$/.test(source.pathname)) return { label: 'Play on Spotify', url: `${source.origin}${source.pathname}` }
  }
  const query = Array.from([track.artist, track.title].filter(value => typeof value === 'string').join(' ').trim()).slice(0, 32).join('')
  return query ? { label: 'Find on YouTube Music', url: `https://music.youtube.com/search?q=${encodeURIComponent(query)}` } : null
}

function artworkUrl(track) {
  const url = publicUrl(track.artwork_url)
  if (url) return url.href
  const button = songButton(track)
  if (button?.label === 'Play on YouTube Music') {
    return `https://i.ytimg.com/vi/${new URL(button.url).searchParams.get('v')}/hqdefault.jpg`
  }
  return null
}

function milliseconds(track, field) {
  const explicit = track[`${field}_ms`]
  const value = explicit != null ? Number(explicit) : Number(track[field]) * 1000
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/** Raw Discord IPC activity: discord-rpc's setActivity helper drops type. */
function buildActivity(track, isPlaying, { now = Date.now(), receivedAt = now, artwork = 'lokal_music' } = {}) {
  if (!track) return null
  const duration = milliseconds(track, 'duration')
  const elapsed = isPlaying ? Math.max(0, now - receivedAt) : 0
  const position = Math.min(milliseconds(track, 'position') + elapsed, duration || Infinity)
  const sourceButton = songButton(track)
  const activity = {
    type: 2, // Listening
    status_display_type: 1, // Show the song title in the user's status.
    details: text(track.title, 'Unknown Track'),
    state: text(track.artist, 'Unknown Artist'),
    assets: {
      large_image: artworkUrl(track) || artwork,
      large_text: text(track.album, 'Lokal'),
      ...(!isPlaying ? { small_image: 'paused', small_text: 'Paused' } : {}),
    },
    buttons: [sourceButton, { label: 'View App on GitHub', url: GITHUB_URL }].filter(Boolean),
    instance: false,
  }
  if (isPlaying) {
    activity.timestamps = { start: Math.round(now - position) }
    if (duration > 0) activity.timestamps.end = Math.round(now + duration - position)
  }
  return activity
}

module.exports = { buildActivity, artworkUrl }
