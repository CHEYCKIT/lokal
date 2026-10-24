// Discord artwork needs a graded identity match, not a raw catalogue string
// comparison. Catalogue credits often include a guest that local tags omit.
const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const cleanTitle = value => String(value || '').slice(0, 300)
  .replace(/\s*[([{]\s*(?:explicit|clean)\s*[)\]}]\s*$/i, '')
  .replace(/\s*[([{]\s*(?:feat(?:uring)?\.?|ft\.?)\s+[^)\]}]+[)\]}]\s*$/i, '')
  .replace(/\s+(?:feat(?:uring)?\.?|ft\.?)\s+.+$/i, '')
  .trim()

// A remix, live performance or alternate recording must not inherit artwork
// from a different version simply because the principal title is identical.
const alternateVersion = /\b(remix|live|instrumental|acoustic|demo|karaoke|sped up|slowed|nightcore|radio edit|cover version)\b/i

function editDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j]
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return previous[b.length]
}

function titleConfidence(wanted, found) {
  const a = normalize(cleanTitle(wanted))
  const b = normalize(cleanTitle(found))
  if (!a || !b) return 0
  if (a === b) return 1
  if (alternateVersion.test(a) || alternateVersion.test(b)) return 0
  // Short titles are too ambiguous for fuzzy correction: "Dangerous 2"
  // is not the same recording as "Dangerous".
  if (a.split(' ').length < 3 || b.split(' ').length < 3) return 0
  const similarity = 1 - editDistance(a, b) / Math.max(a.length, b.length)
  const aWords = new Set(a.split(' '))
  const bWords = new Set(b.split(' '))
  const overlap = [...aWords].filter(word => bWords.has(word)).length
  if (similarity < 0.82 || overlap < Math.max(2, Math.ceil(Math.min(aWords.size, bWords.size) / 2))) return 0
  return similarity
}

function primaryArtist(value) {
  const name = String(value || '').split(/\s+(?:feat(?:uring)?\.?|ft\.?)\s+/i)[0].trim()
  // Names containing commas are often bands (Earth, Wind & Fire; Tyler,
  // The Creator), not lists of credited guests. Don't truncate them.
  if (name.includes(',')) return name
  return name.split(/\s+(?:&|and|with|x|vs\.?)\s+/i)[0].trim()
}

function artistConfidence(wanted, found) {
  const a = normalize(wanted)
  const b = normalize(found)
  if (!a || !b) return 0
  if (a === b) return 1
  const firstA = normalize(primaryArtist(wanted))
  const firstB = normalize(primaryArtist(found))
  return firstA.length >= 4 && firstA === firstB ? 0.94 : 0
}

const MIN_DISCORD_ARTWORK_SCORE = 90

/** Integer 0–100 confidence, with album/duration as optional tie breakers. */
function scoreDiscordArtwork(wanted, found) {
  const artist = artistConfidence(wanted.artist, found.artist)
  if (!artist) return 0
  const title = titleConfidence(wanted.title, found.title)
  if (!title) return 0
  let score = 100 * (0.65 * title + 0.35 * artist)
  if (wanted.type !== 'album') {
    if (normalize(wanted.album) && normalize(found.album)) {
      score += normalize(wanted.album) === normalize(found.album) ? 2 : -3
    }
    const a = Number(wanted.duration), b = Number(found.duration)
    if (a > 0 && b > 0) {
      const delta = Math.abs(a - b)
      score += delta <= 5 ? 2 : delta >= 20 ? -5 : 0
    }
  }
  return Math.max(0, Math.min(100, Math.round(score)))
}

module.exports = { scoreDiscordArtwork, MIN_DISCORD_ARTWORK_SCORE }
