/** Filter playlist rows like Spotify's playlist search: every search word must
 * occur in the song title, artist, or album. The original row order is kept. */
export function filterPlaylistTracks(tracks, query) {
  const words = String(query || '').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!words.length) return Array.isArray(tracks) ? tracks : []
  return (Array.isArray(tracks) ? tracks : []).filter(track => {
    const text = [track?.title, track?.artist, track?.album]
      .map(value => String(value || '').toLocaleLowerCase())
      .join(' ')
    return words.every(word => text.includes(word))
  })
}
