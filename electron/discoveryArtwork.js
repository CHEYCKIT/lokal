const { scoreDiscordArtwork, MIN_DISCORD_ARTWORK_SCORE } = require('./discord/artworkMatch')

const key = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const imageUrl = value => {
  const url = String(value || '').replace(/^http:/, 'https:')
  return /^https:\/\//.test(url) && !/2a96cbd8|default_album|noimage|\/artist\/\//i.test(url) ? url : ''
}

async function json(url, fetchImpl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetchImpl(url, { signal: controller.signal })
    return response.ok ? await response.json() : null
  } catch { return null }
  finally { clearTimeout(timer) }
}

/** Resolve only artwork for provider metadata; never change recommendation identity. */
function createArtworkResolver({ getDB = () => null, isElectron = false, fetchImpl = fetch, searchArtists, searchSongs, discordScoring = false } = {}) {
  const cache = new Map()
  const pending = new Map()
  const local = item => {
    try {
      const db = getDB()
      if (!db) return ''
      if (item.type === 'artist') {
        const row = db.prepare('SELECT id, image_path FROM artists WHERE lower(trim(name)) = lower(trim(?)) AND image_path IS NOT NULL LIMIT 1').get(item.artist)
        if (row?.image_path) return isElectron ? `file://${row.image_path}` : `/api/artist-image/${encodeURIComponent(row.id)}`
      } else {
        const field = item.type === 'album' ? 'album' : 'title'
        const row = db.prepare(`SELECT id, artwork_path, artwork_url FROM tracks WHERE lower(trim(${field})) = lower(trim(?)) AND lower(trim(COALESCE(album_artist, artist))) = lower(trim(?)) AND (artwork_path IS NOT NULL OR artwork_url IS NOT NULL) LIMIT 1`).get(item.title, item.artist)
        if (row?.artwork_path) return isElectron ? `file://${row.artwork_path}` : `/api/artwork/${encodeURIComponent(row.id)}`
        if (imageUrl(row?.artwork_url)) return imageUrl(row.artwork_url)
      }
    } catch { /* Missing local art should still try provider metadata. */ }
    return ''
  }
  const remote = async item => {
    const allowed = value => { const image = imageUrl(value); return image && image !== item.exclude ? image : '' }
    const firstImage = (...values) => values.map(allowed).find(Boolean) || ''
    const highestConfidence = (rows, mapCandidate, imageOf) => rows.map(row => ({
      row, score: scoreDiscordArtwork(item, mapCandidate(row)),
    })).filter(candidate => candidate.score >= MIN_DISCORD_ARTWORK_SCORE && imageOf(candidate.row))
      .sort((a, b) => b.score - a.score)[0]?.row
    if (item.type === 'artist') {
      const deezer = await json(`https://api.deezer.com/search/artist?q=${encodeURIComponent(item.artist)}&limit=10`, fetchImpl)
      const match = (deezer?.data || []).find(row => key(row.name) === key(item.artist) && firstImage(row.picture_xl, row.picture_big))
      if (match) return firstImage(match.picture_xl, match.picture_big)
      if (searchArtists) {
        const candidates = await searchArtists(item.artist, { source: 'wikidata' }).catch(() => [])
        const artist = candidates.find(row => key(row.title) === key(item.artist) && allowed(row.imageUrl))
        if (artist) return allowed(artist.imageUrl)
      }
      const songs = await json(`https://api.deezer.com/search?q=${encodeURIComponent(`artist:"${item.artist}"`)}&limit=10`, fetchImpl)
      const songImage = row => firstImage(row?.artist?.picture_xl, row?.artist?.picture_big, row?.album?.cover_xl, row?.album?.cover_big)
      const song = (songs?.data || []).find(row => key(row.artist?.name) === key(item.artist) && songImage(row))
      if (song) return songImage(song)
      return ''
    }
    const album = item.type === 'album'
    const query = album ? `artist:"${item.artist}" album:"${item.title}"` : `artist:"${item.artist}" track:"${item.title}"`
    const deezer = await json(`https://api.deezer.com/search${album ? '/album' : ''}?q=${encodeURIComponent(query)}&limit=15`, fetchImpl)
    const coverOf = row => album ? firstImage(row?.cover_xl, row?.cover_big) : firstImage(row?.album?.cover_xl, row?.album?.cover_big)
    const deezerRows = deezer?.data || []
    const match = discordScoring
      ? highestConfidence(deezerRows, row => ({
          type: item.type, title: row.title, artist: row.artist?.name,
          album: album ? row.title : row.album?.title, duration: row.duration,
        }), coverOf)
      : deezerRows.find(row => (album ? key(row.title) === key(item.title) : key(row.title) === key(item.title)) && key(row.artist?.name) === key(item.artist) && coverOf(row))
    const cover = coverOf(match)
    if (cover) return cover
    const itunes = await json(`https://itunes.apple.com/search?term=${encodeURIComponent(`${item.artist} ${item.title}`)}&entity=${album ? 'album' : 'song'}&limit=15`, fetchImpl)
    const appleImage = row => allowed(row?.artworkUrl100?.replace(/100x100bb/, '600x600bb'))
    const itunesRows = itunes?.results || []
    const apple = discordScoring
      ? highestConfidence(itunesRows, row => ({
          type: item.type, title: album ? row.collectionName : row.trackName,
          artist: row.artistName, album: row.collectionName,
          duration: row.trackTimeMillis ? row.trackTimeMillis / 1000 : undefined,
        }), appleImage)
      : itunesRows.find(row => (album ? key(row.collectionName) === key(item.title) : key(row.trackName) === key(item.title)) && key(row.artistName) === key(item.artist) && appleImage(row))
    const appleCover = appleImage(apple)
    if (appleCover) return appleCover
    if (!album && searchSongs) {
      const songs = await searchSongs(`${item.artist} ${item.title}`).catch(() => [])
      const song = discordScoring
        ? highestConfidence(songs, row => ({
            type: 'track', title: row.title, artist: row.artist || row.artists?.[0],
            album: row.album, duration: row.duration,
          }), row => allowed(row.thumbnail))
        : songs.find(row => key(row.title) === key(item.title) && (row.artists || [row.artist]).some(artist => key(artist) === key(item.artist)) && allowed(row.thumbnail))
      return allowed(song?.thumbnail)
    }
    return ''
  }
  const resolve = async raw => {
    const item = { type: ['artist', 'album', 'track'].includes(raw?.type) ? raw.type : 'track', title: String(raw?.title || '').slice(0, 300), artist: String(raw?.artist || '').slice(0, 300), image: raw?.image, exclude: raw?.exclude }
    item.album = discordScoring ? String(raw?.album || '').slice(0, 300) : ''
    item.duration = discordScoring ? Math.max(0, Number(raw?.duration) || 0) : 0
    item.exclude = imageUrl(item.exclude) || item.exclude
    if (!item.artist || (item.type !== 'artist' && !item.title)) return { image: '' }
    if (imageUrl(item.image) && imageUrl(item.image) !== item.exclude) return { image: imageUrl(item.image) }
    const localImage = local(item)
    if (localImage && localImage !== item.exclude) return { image: localImage }
    const id = `${item.type}\0${key(item.artist)}\0${key(item.title)}\0${item.exclude || ''}\0${key(item.album)}\0${item.duration}`
    const cached = cache.get(id)
    if (cached && Date.now() - cached.at < (cached.image ? 86400000 : 300000)) return { image: cached.image }
    if (!pending.has(id)) {
      pending.set(id, remote(item).then(image => {
        cache.set(id, { image, at: Date.now() })
        if (cache.size > 1000) cache.delete(cache.keys().next().value)
        return { image }
      }).finally(() => pending.delete(id)))
    }
    return pending.get(id)
  }
  return async items => {
    const batch = Array.isArray(items) ? items.slice(0, 100) : []
    const results = new Array(batch.length)
    let next = 0
    await Promise.all(Array.from({ length: Math.min(4, batch.length) }, async () => {
      while (next < batch.length) { const at = next++; results[at] = await resolve(batch[at]).catch(() => ({ image: '' })) }
    }))
    return results
  }
}

module.exports = { createArtworkResolver }
