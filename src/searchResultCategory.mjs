// Search source (Library/Online/All) and result type are independent,
// single-choice controls, matching the mobile search filters.
export const SEARCH_RESULT_CATEGORIES = Object.freeze(['songs', 'artists', 'albums'])
export const normalizeResultCategory = category =>
  SEARCH_RESULT_CATEGORIES.includes(category) ? category : 'songs'
export const includesResultCategory = (selected, category) => {
  const filter = normalizeResultCategory(selected)
  return filter === category
}
export const categoryLabel = category => ({
  songs: 'Songs', artists: 'Artists', albums: 'Albums',
})[normalizeResultCategory(category)]

// Local entries win over matching catalogue metadata. Do not merge recordings
// or albums merely because the titles share words; artist+album is preferred.
// Local album search results on older libraries sometimes omit the artist:
// only use their title as a fallback if the local title is unambiguous.
const normalize = s => String(s || '').normalize('NFKC')
  .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export function mergeSearchArtists(local = [], online = []) {
  const seen = new Set()
  const result = []
  for (const [origin, rows] of [['library', local], ['online', online]]) {
    for (const item of rows) {
      const name = String(item?.name || item?.title || '').trim()
      const key = normalize(name)
      if (!key || seen.has(key)) continue
      seen.add(key)
      result.push({ origin, item, key })
    }
  }
  return result
}

export function mergeSearchAlbums(local = [], online = []) {
  const result = []
  const seen = new Set()
  const localTitleCounts = new Map()
  for (const item of local) {
    const title = normalize(item?.title || item?.name)
    if (title) localTitleCounts.set(title, (localTitleCounts.get(title) || 0) + 1)
  }
  const libraryHasTitleOnly = new Set()
  for (const item of local) {
    const title = normalize(item?.title || item?.name)
    const artist = normalize(item?.artist || item?.album_artist || item?.albumArtist)
    if (title && !artist && localTitleCounts.get(title) === 1) libraryHasTitleOnly.add(title)
  }
  for (const [origin, rows] of [['library', local], ['online', online]]) {
    for (const item of rows) {
      const title = normalize(item?.title || item?.name)
      const artist = normalize(item?.artist || item?.album_artist || item?.albumArtist)
      if (!title) continue
      const key = title + '\u001f' + artist
      if (seen.has(key) || (origin === 'online' && libraryHasTitleOnly.has(title))) continue
      seen.add(key)
      result.push({ origin, item, key })
    }
  }
  return result
}
