const artistKey = value => String(value || '').normalize('NFKC').trim().toLowerCase()
const releaseDate = release => String(release.release_date || release.releaseDate || release.year || '')

export async function loadArtistReleases(artist, client, { timeoutMs = 12000 } = {}) {
  let timer
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => client.discoveryCatalogue({ type: 'releases', artist, source: 'youtube' })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Artist release lookup timed out.')), timeoutMs) }),
    ])
    if (result?.error) throw new Error(result.error)
    if (!Array.isArray(result?.albums)) throw new Error('Artist release catalogue unavailable.')
    return result.albums
  } finally { clearTimeout(timer) }
}

// ---------------------------------------------------------------- Releases tab

const RELEASES_KEY = 'lokal:releases'
export const RELEASE_LIMIT = 100

/** The last check's releases (Home → Releases), or null. */
export function savedReleases(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(RELEASES_KEY) || 'null')
    return saved && Array.isArray(saved.items) ? saved : null
  } catch { return null }
}

function saveReleases(value, storage = globalThis.localStorage) {
  try { storage?.setItem(RELEASES_KEY, JSON.stringify(value)) } catch {}
}

export const releaseKey = release => `${artistKey(release.artist)}\0${artistKey(release.title)}`

const DAY = 24 * 60 * 60 * 1000
export const NEW_RELEASE_DAYS = 7

/**
 * Out less than a week ago. Only a release with its full date can be: one
 * dated by its year alone can't be told apart from the rest of that year.
 * A plain date ("2026-10-08") is that day in UTC, as it's shown.
 */
export function isNewRelease(release, now = Date.now()) {
  const date = releaseDate(release)
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return false
  const released = Date.parse(date.length === 10 ? `${date}T00:00:00Z` : date)
  const age = (now instanceof Date ? now.getTime() : now) - released
  return Number.isFinite(age) && age >= 0 && age < NEW_RELEASE_DAYS * DAY
}

/**
 * The newest releases first, at most `limit`: no year cut-off, only nothing
 * dated in the future. A catalogue lists each artist's releases newest first,
 * so releases with the same date keep that order (`rank`).
 */
export function latestReleases(releases, { now = new Date(), limit = RELEASE_LIMIT } = {}) {
  const seen = new Set()
  return releases
    .filter(release => release?.title && release?.artist && Number(releaseDate(release).slice(0, 4)))
    .filter(release => {
      const date = releaseDate(release)
      if (Number(date.slice(0, 4)) > now.getFullYear()) return false
      return !(date.length > 4 && Number.isFinite(Date.parse(date)) && Date.parse(date) > now.getTime())
    })
    .sort((a, b) => releaseDate(b).localeCompare(releaseDate(a)) || (a.rank ?? 0) - (b.rank ?? 0))
    .filter(release => {
      const key = releaseKey(release)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}

/**
 * Check every library artist's catalogue (a few at a time) for releases the
 * last check didn't have, and add them to it: the list never starts over,
 * and while the check runs it shows the last one plus what's been added
 * (`onProgress({ done, total, items, added })`). Artists no longer in the
 * library drop out. Keeps the newest `limit`, saved for the next visit.
 * Which are new is worked out when they're shown (isNewRelease), so a
 * release stops being new a week after it came out.
 */
export async function checkReleases(artists, loadAlbums, { isCurrent = () => true, onProgress = () => {}, concurrency = 4, now = new Date(), storage = globalThis.localStorage, previous = savedReleases(storage) } = {}) {
  const names = [...new Map(artists.filter(artist => artist?.name).map(artist => [artistKey(artist.name), artist.name])).values()]
  const library = new Set(names.map(artistKey))
  // The last check's releases stay (a failed lookup keeps its artist's too).
  const kept = (previous?.items || []).filter(release => library.has(artistKey(release.seedArtist || release.artist)))
  const known = new Set(kept.map(releaseKey))
  const found = []
  let done = 0
  let failures = 0
  let next = 0
  // A release found again replaces the last check's copy (fresher artwork,
  // a corrected date); the others stay as they were.
  const current = () => {
    const byKey = new Map(kept.map(release => [releaseKey(release), release]))
    for (const release of found) byKey.set(releaseKey(release), release)
    return latestReleases([...byKey.values()], { now })
  }
  const added = items => items.filter(release => !known.has(releaseKey(release))).length
  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, async () => {
    while (isCurrent() && next < names.length) {
      const name = names[next++]
      try {
        const albums = await loadAlbums(name)
        ;(albums || []).forEach((album, rank) => found.push({ ...album, artist: album.artist || name, seedArtist: name, rank }))
      } catch {
        failures++
      }
      done++
      if (isCurrent()) { const items = current(); onProgress({ done, total: names.length, items, added: added(items) }) }
    }
  }))
  const items = current()
  const result = { items, checkedAt: now.getTime(), artists: names.length, failures, added: added(items) }
  // Nothing could be checked (offline): keep the last check as it was.
  if (names.length && failures === names.length && previous) return { ...previous, failures }
  if (isCurrent()) saveReleases(result, storage)
  return result
}
