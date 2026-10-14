// Shared ordering and request shape for searches launched from a streamed
// song's "Save to library" context menu and the Search page itself.

export const DEFAULT_SEARCH_SOURCES = Object.freeze([
  { id: 'yt', label: 'YouTube Music' },
  { id: 'sc', label: 'SoundCloud' },
])

export const SOULSEEK_SEARCH_SOURCE = Object.freeze({ id: 'slsk', label: 'Soulseek' })

/** Built-ins first, then Soulseek, then the user's enabled search addons. */
export function orderedFindOnSources(providers) {
  const available = new Map(DEFAULT_SEARCH_SOURCES.map(source => [source.id, source]))
  for (const source of Array.isArray(providers) ? providers : []) {
    if (!source?.id) continue
    available.set(source.id, { ...available.get(source.id), ...source })
  }
  available.delete('slsk')
  const sources = [...available.values()]
  return [
    ...sources.filter(source => !source.addon),
    SOULSEEK_SEARCH_SOURCE,
    ...sources.filter(source => source.addon),
  ]
}

/** Default menu entries before installed providers have loaded. */
export const DEFAULT_FIND_ON_SOURCES = Object.freeze(orderedFindOnSources(DEFAULT_SEARCH_SOURCES))

/** Build a Search-page request while retaining the stream to replace on save. */
export function buildFindOnRequest(provider, track, fallback = {}) {
  const title = String(track?.title || fallback?.title || '').trim()
  const artist = String(
    track?.artist ||
    (Array.isArray(track?.artists) ? track.artists.join(', ') : '') ||
    fallback?.artist ||
    (Array.isArray(fallback?.artists) ? fallback.artists.join(', ') : '') ||
    '',
  ).trim()
  const query = [artist, title].filter(Boolean).join(' ')
    .replace(/\s*\((?:feat|ft)\.?[^)]*\)/i, '')
    .trim()
  return { provider, query, replaceTrackId: track?.id || undefined, title, artist }
}
