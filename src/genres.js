import taxonomy from '../electron/genreTaxonomy.json' with { type: 'json' }

// Identity keys keep an existing alias (e.g. VGM) from appearing again as a
// separate suggestion (e.g. Video Game Music) while preserving the stored text.
const taxonomyKey = value => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '')

const genreAliases = new Map()
for (const [canonical, aliases] of taxonomy.groups) {
  genreAliases.set(taxonomyKey(canonical), taxonomyKey(canonical))
  for (const alias of aliases) genreAliases.set(taxonomyKey(alias), taxonomyKey(canonical))
}

const SEPARATORS = /[\\/;,|]/

export const genreKey = name => {
  const raw = String(name || '').replace(/\s+/g, ' ').trim()
  const key = taxonomyKey(raw)
  return genreAliases.get(key) || key
}

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
