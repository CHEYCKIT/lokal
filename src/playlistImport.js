export function openPlaylistImport(source = 'link') {
  window.dispatchEvent(new CustomEvent('lokal:playlist-import', { detail: { source } }))
}

export const FILE_PLATFORMS = [
  { id: 'spotify', label: 'Spotify / Exportify CSV' },
  { id: 'apple-music', label: 'Apple Music Export' },
  { id: 'youtube-music', label: 'YouTube Music / Google Takeout' },
  { id: 'lastfm', label: 'Last.fm Export' },
  { id: 'generic', label: 'Generic CSV / JSON / M3U' },
]

export function formatDuration(seconds) {
  const total = Math.round(Number(seconds) || 0)
  if (!total) return ''
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
