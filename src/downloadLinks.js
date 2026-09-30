// What the downloader needs outside a page of its own: telling a pasted link
// from a search, whether it's one song or a whole playlist / album / channel,
// a readable name for it, the download formats (a setting), and whether
// YouTube will likely let it through (a cookie is set up).

export const DISCLAIMER_KEY = 'lokal-dl-accepted'
export const COOKIE_HINT_KEY = 'lokal-yt-cookie-hint-dismissed'

// Honest formats: nothing claims to be better than the source it came from.
// Original is the default: it's the best quality and needs no re-encoding.
export const DEFAULT_FORMAT = 'original'
export const FORMATS = [
  { id: 'original', label: 'Original', hint: 'The source audio as-is (Opus or AAC on YouTube), no re-encoding. Best quality, smallest files.' },
  { id: 'mp3', label: 'MP3', hint: 'Re-encoded to MP3 for players and devices that need it.' },
  { id: 'm4a', label: 'M4A', hint: 'AAC in an M4A file, copied without re-encoding when the source is AAC.' },
  { id: 'opus', label: 'Opus', hint: 'Opus, copied without re-encoding when the source is Opus (most of YouTube).' },
]
export const MP3_BITRATES = ['128', '192', '320']

/** The saved download format, or the default when none (or an old one) is saved. */
export function savedFormat(settings) {
  const saved = String(settings?.download_format || DEFAULT_FORMAT)
  return FORMATS.some(f => f.id === saved) ? saved : DEFAULT_FORMAT
}

/** Is a YouTube cookie set up (turned on, and the chosen source filled in)? */
export function youTubeCookieReady(settings) {
  if (settings?.yt_cookies !== '1') return false
  const source = settings.yt_cookie_browser || 'paste'
  if (source === 'paste') return !!settings.yt_cookie_header
  if (source === 'file') return !!settings.yt_cookie_file
  return true
}

/** The link in `text` when that's all it is ("https://…", "youtu.be/…"), else null. */
export function asLink(text) {
  const value = String(text || '').trim()
  if (!value || /\s/.test(value)) return null
  const withScheme = /^https?:\/\//i.test(value) ? value : /^(?:www\.|m\.|music\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/\S*/i.test(value) ? `https://${value}` : null
  if (!withScheme) return null
  try {
    const url = new URL(withScheme)
    return /\./.test(url.hostname) ? url.href : null
  } catch {
    return null
  }
}

/**
 * Is the link one song ('single'), several ('playlist': a playlist, an
 * album, a channel), or a song played from a playlist ('both': either can
 * be downloaded)? Unknown sites count as several, as the old Playlist /
 * Album tab did: yt-dlp takes a single song that way too.
 */
export function linkKind(link) {
  let url
  try { url = new URL(link) } catch { return 'playlist' }
  const host = url.hostname.replace(/^(?:www|m)\./, '')
  const parts = url.pathname.split('/').filter(Boolean)
  // A mix ("RD…") is endless radio made up for the listener, not a playlist.
  const list = url.searchParams.get('list') || ''
  const inList = !!list && !list.startsWith('RD')
  if (host === 'youtu.be') return inList ? 'both' : 'single'
  if (/(^|\.)youtube\.com$/.test(host)) {
    if (url.pathname === '/watch') return inList ? 'both' : 'single'
    if (parts[0] === 'shorts') return 'single'
    return 'playlist'
  }
  if (/(^|\.)soundcloud\.com$/.test(host)) {
    // soundcloud.com/artist/song is a song; /artist, /artist/sets/album, /artist/tracks are several.
    return parts.length === 2 && !['sets', 'tracks', 'albums', 'likes', 'reposts', 'popular-tracks'].includes(parts[1]) ? 'single' : 'playlist'
  }
  if (/(^|\.)bandcamp\.com$/.test(host)) return parts[0] === 'track' ? 'single' : 'playlist'
  return 'playlist'
}

function prettifySlug(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase())
}

/** A name for a link before the source says what it's called. */
export function inferTitleFromUrl(url, fallback = 'Download') {
  if (!url) return fallback
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    const listId = parsed.searchParams.get('list')
    const parts = parsed.pathname.split('/').filter(Boolean)

    if (host.includes('youtube') || host === 'youtu.be') {
      if (parsed.pathname.includes('/channel/') || parsed.pathname.includes('/c/') || parsed.pathname.includes('/@')) {
        const segment = parts.find(part => part.startsWith('@')) || parts[parts.length - 1]
        return segment ? prettifySlug(segment.replace(/^@/, '')) : 'YouTube Channel'
      }
      if (listId && !parsed.searchParams.get('v')) return `YouTube Playlist ${listId.slice(0, 8)}`
      if (parsed.pathname.includes('/playlist')) return 'YouTube Playlist'
      if (parsed.pathname.includes('/watch') || host === 'youtu.be') return 'YouTube Track'
      if (parsed.hostname.includes('music.youtube')) return 'YouTube Music Release'
      return 'YouTube Download'
    }

    if (host.includes('soundcloud')) {
      if (parts.length >= 3 && parts[1] === 'sets') return prettifySlug(parts[2])
      if (parts.length === 2) return prettifySlug(`${parts[0]} ${parts[1]}`)
      if (parts.length === 1) return prettifySlug(parts[0])
      return 'SoundCloud Download'
    }
    if (host.includes('bandcamp')) {
      if (parts.length >= 2) return prettifySlug(parts[1])
      return prettifySlug(host.split('.')[0]) || 'Bandcamp Download'
    }
    return prettifySlug(host.split('.').slice(0, -1).join(' ')) || fallback
  } catch {
    return fallback
  }
}

export function isGenericTitle(title) {
  const normalized = String(title || '').trim().toLowerCase()
  return !normalized || normalized === 'download' || normalized === 'playlist / album'
}

/** What to call a download or downloaded playlist: its title, else one from its link. */
export function displayTitle(item, fallback = 'Download') {
  if (!item) return fallback
  if (!isGenericTitle(item.title) && item.title !== item.url) return item.title
  return inferTitleFromUrl(item.url, fallback)
}

/** An artist search's channels and playlists, without duplicates. */
export function normalizeArtistResults(items) {
  const seen = new Set()
  return (Array.isArray(items) ? items : [])
    .filter(item => item?.title && item?.url && (item.type === 'channel' || item.type === 'playlist'))
    .filter(item => {
      const key = `${item.type}:${item.id || item.url}:${item.url}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** For a song played from a playlist: the song alone, and the playlist. */
export function splitLink(link) {
  try {
    const url = new URL(link)
    const list = url.searchParams.get('list')
    // youtu.be/<id>: only the first part of the path is the video.
    const id = url.hostname.replace(/^www\./, '') === 'youtu.be' ? url.pathname.split('/').filter(Boolean)[0] : url.searchParams.get('v')
    return {
      song: id ? `https://www.youtube.com/watch?v=${id}` : link,
      list: list ? `https://www.youtube.com/playlist?list=${list}` : link,
    }
  } catch {
    return { song: link, list: link }
  }
}
