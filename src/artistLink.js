// Shared logic for turning a track's `artist` name into a link to that
// artist's page. Artist IDs in this app are `a-<slugified-name>` (see
// server/routes/artists.js), and tracks only carry the artist's display
// name, not a resolved id -- so every call site has to re-derive the same
// slug. Centralised here so PlayerBar, RightSidebar, etc. can't drift.

export function artistToSlug(artistName, keepCommaArtists = []) {
  if (!artistName) return ''
  const lowerName = artistName.toLowerCase().trim()
  for (const keep of keepCommaArtists) {
    const lowerKeep = keep.toLowerCase().trim()
    if (lowerName === lowerKeep || lowerName.startsWith(lowerKeep + ' ') || lowerName.endsWith(' ' + lowerKeep)) {
      return keep.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    }
  }
  const firstPart = artistName.split(',')[0].trim()
  return firstPart.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function navigateToTrackArtist(nav, track, keepCommaArtists = []) {
  if (!nav || !track?.artist) return false
  const slug = artistToSlug(track.artist, keepCommaArtists)
  if (!slug) return false
  nav(`/artist/a-${slug}`)
  return true
}
