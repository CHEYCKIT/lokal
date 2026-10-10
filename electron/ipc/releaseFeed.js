const fs = require('fs')
const path = require('path')
const { getStorageDir } = require('./db')

const USER_AGENT = 'Lokal/1.9.0 (https://github.com/sipbuu/lokal)'
const MB_URL = 'https://musicbrainz.org/ws/2'
const CACHE_FILE = 'release-feed.json'
const ARTIST_TTL_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 120
const FUTURE_DAYS = 14
const PAGE_SIZE = 100
const MAX_PAGES = 4
// MusicBrainz asks for at most one request a second.
const MIN_GAP_MS = 1100
const RELEASE_TYPES = new Set(['Album', 'EP', 'Single'])

let cache = null
let saveTimer = null
let queue = Promise.resolve()
let lastRequestAt = 0

function loadCache() {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(path.join(getStorageDir(), CACHE_FILE), 'utf8'))
  } catch {}
  if (!cache || typeof cache !== 'object') cache = {}
  return cache
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(path.join(getStorageDir(), CACHE_FILE), JSON.stringify(cache)) } catch {}
  }, 500)
}

function musicBrainzJson(url) {
  const run = async () => {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now()
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    lastRequestAt = Date.now()
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`MusicBrainz returned ${res.status}`)
    return res.json()
  }
  const job = queue.then(run)
  queue = job.catch(() => {})
  return job
}

const nameKey = name => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')

async function findArtistId(name) {
  const data = await musicBrainzJson(`${MB_URL}/artist?query=${encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`)}&fmt=json&limit=5`)
  const match = (data?.artists || []).find(artist => nameKey(artist.name) === nameKey(name) && (artist.score ?? 0) >= 90)
  return match?.id || null
}

// Release dates are YYYY, YYYY-MM or YYYY-MM-DD; only full dates can be placed in the window.
function inWindow(date, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false
  const time = Date.parse(`${date}T00:00:00Z`)
  return time >= now - WINDOW_DAYS * 86400000 && time <= now + FUTURE_DAYS * 86400000
}

async function fetchArtistReleases(mbid, now = Date.now()) {
  const releases = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE
    const data = await musicBrainzJson(`${MB_URL}/release-group?artist=${mbid}&fmt=json&limit=${PAGE_SIZE}&offset=${offset}&inc=artist-credits`)
    for (const group of data?.['release-groups'] || []) {
      const type = group['primary-type']
      if (!RELEASE_TYPES.has(type) || (group['secondary-types'] || []).length) continue
      if (!inWindow(group['first-release-date'], now)) continue
      const credits = group['artist-credit'] || []
      releases.push({
        id: group.id,
        title: group.title,
        date: group['first-release-date'],
        type: type.toLowerCase(),
        // Credited first: the artist's own release. Anywhere else: a featured or supporting credit.
        role: credits[0]?.artist?.id === mbid ? 'main' : 'supporting',
        artists: credits.map(credit => `${credit.name}${credit.joinphrase || ''}`).join(''),
        artworkUrl: `https://coverartarchive.org/release-group/${group.id}/front-250`,
        url: `https://musicbrainz.org/release-group/${group.id}`,
      })
    }
    if (offset + PAGE_SIZE >= (data?.['release-group-count'] || 0)) break
  }
  return releases.sort((a, b) => b.date.localeCompare(a.date))
}

async function artistFeed(name) {
  const store = loadCache()
  const key = nameKey(name)
  const entry = store[key]
  if (entry && Date.now() - entry.checkedAt < ARTIST_TTL_MS) return { name, mbid: entry.mbid, releases: entry.releases }
  const mbid = await findArtistId(name)
  const releases = mbid ? await fetchArtistReleases(mbid) : []
  store[key] = { mbid, releases, checkedAt: Date.now() }
  scheduleSave()
  return { name, mbid, releases }
}

/** New releases for each library artist name, one at a time, cached for a day. */
async function fetchReleaseFeed(names) {
  const results = []
  for (const name of [...new Set((names || []).map(n => String(n || '').trim()).filter(Boolean))].slice(0, 50)) {
    try {
      results.push(await artistFeed(name))
    } catch (error) {
      results.push({ name, error: error.message || 'Could not load releases' })
    }
  }
  return results
}

function registerReleaseFeedHandlers(ipcMain) {
  ipcMain.handle('releaseFeed:fetch', (_, names) => fetchReleaseFeed(names))
}

module.exports = { registerReleaseFeedHandlers, fetchReleaseFeed }
