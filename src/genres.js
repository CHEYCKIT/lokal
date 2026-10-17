// A song's genres, split the way the library reads them (electron/genreList.js):
// "Рэп/Караоке", "Rock; Pop" and the comma list in `genres` are each several
// genres. Shown joined with ", ".

const SEPARATORS = /[\\/;,|]/

export const genreKey = name => String(name || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()

/** "Rock / Pop; Indie" -> ['Rock', 'Pop', 'Indie'], without repeats. */
export function splitGenres(value) {
  const out = []
  const seen = new Set()
  for (const part of String(value || '').split(SEPARATORS)) {
    const name = part.replace(/\s+/g, ' ').trim()
    const key = genreKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/** Every genre of a track, from its main genre and its genre list. */
export function trackGenreList(track) {
  return splitGenres([track?.genre, track?.genres].filter(Boolean).join(','))
}

export const genreText = track => trackGenreList(track).join(', ')
