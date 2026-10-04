const list = value => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []

/** Album track order and an artist's catalogue come directly from Last.fm. */
async function lastfmCatalogue(settings, call, { type, artist, album } = {}) {
  artist = String(artist || '').trim().slice(0, 300)
  album = String(album || '').trim().slice(0, 300)
  if (!settings.lastfm_api_key || !artist) return { error: 'Connect Last.fm to load this catalogue.' }
  const result = await call(type === 'album' ? 'album.getInfo' : 'artist.getTopTracks', type === 'album'
    ? { artist, album, autocorrect: '1' } : { artist, autocorrect: '1', limit: '60' }, settings.lastfm_api_key, null)
  if (result?.error) return { error: result.message || 'Catalogue unavailable.' }
  const rows = type === 'album' ? list(result?.album?.tracks?.track) : list(result?.toptracks?.track)
  const artwork = list(result?.album?.image).filter(image => image?.['#text']).at(-1)?.['#text'] || ''
  return { tracks: rows.map(row => ({ title: row.name || '', artist: typeof row.artist === 'string' ? row.artist : row.artist?.name || artist, album: type === 'album' ? album : '', duration: Number(row.duration) || null, artwork_url: artwork, source: 'lastfm' })).filter(row => row.title && row.artist) }
}

module.exports = { lastfmCatalogue }
