const path = require('path')
const fs = require('fs-extra')
const http = require('http')
const https = require('https')
const { getStorageDir } = require('./db')

const ARTIST_METADATA_TTL_MS = 1000 * 60 * 60 * 24 * 7
const USER_AGENT = 'Lokal/1.9.0 (https://github.com/sipbuu/lokal)'

function getJson(url, timeoutMs = 5000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  }).then(async (res) => {
    clearTimeout(timer)
    if (!res.ok) throw new Error(`Request failed: ${res.status}`)
    return res.json()
  }).catch((error) => {
    clearTimeout(timer)
    throw error
  })
}

function shouldFetchField(value, source, fetchedAt) {
  if (source === 'manual') return false
  if (value && String(value).trim()) return false
  const lastFetched = Number(fetchedAt) || 0
  if (!lastFetched) return true
  return Date.now() - lastFetched >= ARTIST_METADATA_TTL_MS
}

function shouldFetchArtistMetadata(artist, fetchImages) {
  return shouldFetchField(artist.bio, artist.bio_source, artist.bio_fetched_at)
    || (fetchImages && shouldFetchField(artist.image_path, artist.image_source, artist.image_fetched_at))
}

function getArtistFetchSettings(db) {
  try {
    const fetchArtwork = db.prepare("SELECT value FROM settings WHERE key = 'fetch_online_artwork'").get()?.value
    return { fetchImages: fetchArtwork !== '0' }
  } catch {
    return { fetchImages: true }
  }
}

function buildArtistQueries(name) {
  const normalized = String(name || '').trim()
  if (!normalized) return []
  return [
    `"${normalized}" musician`,
    `"${normalized}" band`,
    `"${normalized}" artist`,
    normalized,
  ]
}

// 'either' (shown as Auto) combines them: the bio and the picture each come
// from the first provider that has one.
const ARTIST_SOURCES = ['either', 'theaudiodb', 'deezer', 'musicbrainz', 'wikipedia']

function normalizeSource(source) {
  return ARTIST_SOURCES.includes(source) ? source : 'either'
}

/** Settings > Artists > "Artist info source": where bios and pictures come from by default. */
function getDefaultArtistSource(db) {
  try {
    return normalizeSource(db.prepare("SELECT value FROM settings WHERE key = 'artist_metadata_source'").get()?.value)
  } catch {
    return 'either'
  }
}

function isUsefulArtistDescription(description) {
  if (!description) return false
  return /(musician|singer|rapper|band|artist|composer|producer|dj|duo|group|songwriter)/i.test(description)
}

function getWikipediaTitleFromUrl(url) {
  if (!url) return null
  const match = String(url).match(/https?:\/\/[a-z]+\.wikipedia\.org\/wiki\/(.+)$/i)
  if (!match?.[1]) return null
  return decodeURIComponent(match[1]).replace(/_/g, ' ')
}

function buildMusicBrainzBio(artist) {
  if (!artist) return null
  const parts = []
  if (artist.type) parts.push(artist.type)
  if (artist.disambiguation) parts.push(artist.disambiguation)
  const place = artist.area?.name || artist['begin-area']?.name || ''
  if (place) parts.push(place)
  const tags = Array.isArray(artist.tags) ? artist.tags.slice(0, 3).map(tag => tag?.name).filter(Boolean) : []
  if (tags.length) parts.push(tags.join(', '))
  const bio = parts.join(' • ').trim()
  return bio || null
}

async function searchMusicBrainzArtists(query) {
  const normalized = String(query || '').trim()
  if (!normalized) return []
  const data = await getJson(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${normalized}"`)}&fmt=json&limit=8`)
  return Array.isArray(data?.artists) ? data.artists : []
}

async function getMusicBrainzArtistMetadataById(id) {
  if (!id) return null
  try {
    const data = await getJson(`https://musicbrainz.org/ws/2/artist/${encodeURIComponent(id)}?fmt=json&inc=url-rels+tags`)
    const relations = Array.isArray(data?.relations) ? data.relations : []
    const wikipediaRelation = relations.find((relation) => relation?.type === 'wikipedia' || /wikipedia\.org\/wiki\//i.test(relation?.url?.resource || ''))
    const wikipediaTitle = getWikipediaTitleFromUrl(wikipediaRelation?.url?.resource)
    const summary = wikipediaTitle ? await getWikipediaSummary(wikipediaTitle) : null
    const bio = typeof summary?.extract === 'string' && summary.extract.trim() ? summary.extract.trim() : buildMusicBrainzBio(data)
    const imageUrl = summary?.originalimage?.source || summary?.thumbnail?.source || null
    return {
      id: data.id,
      title: data.name,
      bio,
      imageUrl,
      snippet: data.disambiguation || buildMusicBrainzBio(data) || '',
      source: 'musicbrainz',
    }
  } catch {
    return null
  }
}

async function fetchMusicBrainzArtistMetadata(name) {
  const artists = await searchMusicBrainzArtists(name)
  for (const artist of artists) {
    const metadata = await getMusicBrainzArtistMetadataById(artist.id)
    if (metadata?.title) return metadata
  }
  return null
}

// ---------------------------------------------------------------- TheAudioDB
// Bios, artist photos (and fanart) for most well-known artists. The free
// public key allows about 30 requests a minute, so calls are spaced out.
const AUDIODB = 'https://www.theaudiodb.com/api/v1/json/123'
const AUDIODB_GAP_MS = 2100
let audioDbNextAt = 0

async function audioDbGet(url) {
  const wait = audioDbNextAt - Date.now()
  audioDbNextAt = Math.max(Date.now(), audioDbNextAt) + AUDIODB_GAP_MS
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  return getJson(url)
}

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

async function searchAudioDbArtists(query) {
  const normalized = String(query || '').trim()
  if (!normalized) return []
  try {
    const data = await audioDbGet(`${AUDIODB}/search.php?s=${encodeURIComponent(normalized)}`)
    return Array.isArray(data?.artists) ? data.artists : []
  } catch {
    return []
  }
}

function audioDbMetadata(artist) {
  if (!artist?.strArtist) return null
  const bio = typeof artist.strBiographyEN === 'string' && artist.strBiographyEN.trim() ? artist.strBiographyEN.trim() : null
  return {
    id: artist.idArtist,
    title: artist.strArtist,
    bio,
    imageUrl: artist.strArtistThumb || artist.strArtistFanart || null,
    snippet: [artist.strGenre, artist.strCountry].filter(Boolean).join(' • '),
    source: 'theaudiodb',
  }
}

async function fetchAudioDbArtistMetadata(name) {
  const artists = await searchAudioDbArtists(name)
  const match = artists.find(artist => sameName(artist?.strArtist, name))
  return match ? audioDbMetadata(match) : null
}

// ---------------------------------------------------------------- Deezer
// Photos only (Deezer has no bios). Artists without a photo get a grey
// placeholder whose URL has an empty image id ("/artist//"): not a photo.
async function searchDeezerArtists(query) {
  const normalized = String(query || '').trim()
  if (!normalized) return []
  try {
    const data = await getJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(normalized)}&limit=8`)
    return Array.isArray(data?.data) ? data.data : []
  } catch {
    return []
  }
}

function deezerMetadata(artist) {
  const picture = artist?.picture_xl || artist?.picture_big || null
  if (!artist?.name) return null
  return {
    id: String(artist.id || ''),
    title: artist.name,
    bio: null,
    imageUrl: picture && !/\/artist\/\//.test(picture) ? picture : null,
    snippet: artist.nb_fan ? `${Number(artist.nb_fan).toLocaleString('en-US')} fans on Deezer` : '',
    source: 'deezer',
  }
}

async function fetchDeezerArtistMetadata(name) {
  const artists = await searchDeezerArtists(name)
  const match = artists.find(artist => sameName(artist?.name, name))
  return match ? deezerMetadata(match) : null
}

async function searchWikipediaTitle(name) {
  const queries = buildArtistQueries(name)
  for (const query of queries) {
    try {
      const data = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&origin=*`)
      const results = Array.isArray(data?.query?.search) ? data.query.search : []
      const preferred = results.find((entry) => isUsefulArtistDescription(entry?.snippet))
      const first = preferred || results[0]
      if (first?.title) return first.title
    } catch {}
  }
  return null
}

async function getWikipediaSummary(title) {
  if (!title) return null
  try {
    return await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
  } catch {
    return null
  }
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(dest)
    const request = client.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        file.close()
        return downloadToFile(res.headers.location, dest).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        file.close()
        fs.unlink(dest).catch(() => {})
        return reject(new Error(`Image request failed: ${res.statusCode}`))
      }
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve(dest)
      })
    })
    request.on('error', (error) => {
      file.close()
      fs.unlink(dest).catch(() => {})
      reject(error)
    })
  })
}

async function fetchWikipediaArtistMetadata(name) {
  const title = await searchWikipediaTitle(name)
  if (!title) return null
  const metadata = await getArtistMetadataByTitle(title)
  return metadata ? { ...metadata, source: 'wikipedia' } : null
}

const FETCHERS = {
  theaudiodb: fetchAudioDbArtistMetadata,
  deezer: fetchDeezerArtistMetadata,
  musicbrainz: fetchMusicBrainzArtistMetadata,
  wikipedia: fetchWikipediaArtistMetadata,
}

// Auto picks the photo and the bio separately, best source first. No
// Wikipedia: its search lands on the wrong page (a band member's for a band:
// "Eagles" gave Joe Walsh), and its lead images are small stage shots that
// don't read as an artist photo, even from the right page.
// Photos: Deezer's are large square artist photos; TheAudioDB's are curated.
const AUTO_IMAGE_ORDER = ['deezer', 'theaudiodb']
// Bios: TheAudioDB's are written for music; then MusicBrainz, which follows
// the artist's own linked Wikipedia article (or gives a tag line without one).
const AUTO_BIO_ORDER = ['theaudiodb', 'musicbrainz']

/**
 * { bio, imageUrl, source, bioSource, imageSource } for an artist, or null.
 * Auto takes the photo and the bio each from the first provider in its
 * order that has one, asking each provider at most once.
 */
async function fetchArtistMetadata(name, options = {}) {
  const source = normalizeSource(options.source)
  if (source !== 'either') {
    const found = await FETCHERS[source](name).catch(() => null)
    return found ? { ...found, bioSource: source, imageSource: source } : null
  }
  const asked = new Map()
  const ask = (id) => {
    if (!asked.has(id)) asked.set(id, FETCHERS[id](name).catch(() => null))
    return asked.get(id)
  }
  const merged = { title: null, bio: null, imageUrl: null, source: null, bioSource: null, imageSource: null }
  for (const id of AUTO_IMAGE_ORDER) {
    const found = await ask(id)
    if (found?.imageUrl) { merged.imageUrl = found.imageUrl; merged.imageSource = id; merged.title = found.title || null; break }
  }
  for (const id of AUTO_BIO_ORDER) {
    const found = await ask(id)
    if (found?.bio) { merged.bio = found.bio; merged.bioSource = id; merged.title = merged.title || found.title || null; break }
  }
  merged.source = merged.bioSource || merged.imageSource
  return merged.source ? merged : null
}

async function getArtistMetadataByTitle(title) {
  const summary = await getWikipediaSummary(title)
  if (!summary) return null
  const bio = typeof summary.extract === 'string' && summary.extract.trim() ? summary.extract.trim() : null
  const imageUrl = summary.originalimage?.source || summary.thumbnail?.source || null
  return { title, bio, imageUrl }
}

async function searchWikipediaMetadataCandidates(query) {
  const normalized = String(query || '').trim()
  if (!normalized) return []
  try {
    const data = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(normalized)}&srlimit=8&format=json&origin=*`)
    const results = Array.isArray(data?.query?.search) ? data.query.search : []
    const candidates = []
    for (const result of results) {
      if (!result?.title) continue
      const metadata = await getArtistMetadataByTitle(result.title)
      if (!metadata) continue
      candidates.push({
        title: metadata.title,
        bio: metadata.bio,
        imageUrl: metadata.imageUrl,
        snippet: result.snippet || '',
        score: isUsefulArtistDescription(result.snippet) ? 1 : 0,
        source: 'wikipedia',
      })
      if (candidates.length >= 5) break
    }
    return candidates.sort((a, b) => b.score - a.score)
  } catch {
    return []
  }
}

async function searchMusicBrainzMetadataCandidates(query) {
  const artists = await searchMusicBrainzArtists(query)
  const candidates = []
  for (const artist of artists) {
    const metadata = await getMusicBrainzArtistMetadataById(artist.id)
    if (!metadata) continue
    candidates.push({
      title: metadata.title,
      bio: metadata.bio,
      imageUrl: metadata.imageUrl,
      snippet: metadata.snippet || '',
      score: artist.score || 0,
      source: 'musicbrainz',
    })
    if (candidates.length >= 5) break
  }
  return candidates
}

async function searchAudioDbMetadataCandidates(query) {
  return (await searchAudioDbArtists(query)).map(audioDbMetadata).filter(Boolean).slice(0, 5)
}

async function searchDeezerMetadataCandidates(query) {
  return (await searchDeezerArtists(query)).map(deezerMetadata).filter(candidate => candidate?.imageUrl).slice(0, 5)
}

const CANDIDATE_SEARCHES = {
  theaudiodb: searchAudioDbMetadataCandidates,
  deezer: searchDeezerMetadataCandidates,
  musicbrainz: searchMusicBrainzMetadataCandidates,
  wikipedia: searchWikipediaMetadataCandidates,
}

async function searchArtistMetadataCandidates(query, options = {}) {
  const source = normalizeSource(options.source)
  if (source !== 'either') return CANDIDATE_SEARCHES[source](query).catch(() => [])
  // Wikipedia only when picked by hand (see AUTO_IMAGE_ORDER).
  const searches = Object.entries(CANDIDATE_SEARCHES).filter(([id]) => id !== 'wikipedia').map(([, search]) => search)
  const results = await Promise.all(searches.map(search => search(query).catch(() => [])))
  const seen = new Set()
  return results.flat().filter((candidate) => {
    const key = `${candidate.source}:${String(candidate.title || '').toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 10)
}

async function applyArtistMetadataSelection(db, artistId, selection, options = {}) {
  const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(artistId)
  if (!artist) return null
  const mode = options.mode || 'both'
  const now = Date.now()
  let imagePath = artist.image_path || null

  if ((mode === 'both' || mode === 'image') && selection?.imageUrl) {
    const dest = path.join(getStorageDir(), 'artwork', `artist-${artist.id}.jpg`)
    imagePath = await downloadToFile(selection.imageUrl, dest)
  }

  if (mode === 'both' || mode === 'bio') {
    db.prepare(`
      UPDATE artists
      SET bio = ?, bio_source = ?, bio_fetched_at = ?
      WHERE id = ?
    `).run(selection?.bio || '', 'manual', now, artist.id)
  }

  if (mode === 'both' || mode === 'image') {
    db.prepare(`
      UPDATE artists
      SET image_path = ?, image_source = ?, image_fetched_at = ?
      WHERE id = ?
    `).run(imagePath || null, 'manual', now, artist.id)
  }

  return db.prepare('SELECT * FROM artists WHERE id = ?').get(artist.id)
}

function clearArtistImageOverride(db, artistId) {
  // Resolve against the DB before touching the filesystem, the same way
  // applyArtistMetadataSelection above does -- the HTTP route
  // (server/routes/artists.js) already looked the artist up before calling
  // in, but the IPC handler (scanner.js) hands this whatever artistId the
  // renderer sent, unvalidated. Building the artwork path from that raw
  // value let an artistId containing path segments (e.g. "../../etc/passwd")
  // escape the artwork folder; requiring a matching row first closes that.
  const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(artistId)
  if (!artist) return null

  // Clearing image_path here doesn't remove the generated file itself, and
  // /api/artist-image/:artistId (server/index.js) checks for that file on
  // disk BEFORE it ever looks at image_path -- so a manually-set image kept
  // being served after "clearing" it, since the stale artist-<id>.* file was
  // still sitting in the artwork folder shadowing the DB update below.
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const p = path.join(getStorageDir(), 'artwork', `artist-${artist.id}${ext}`)
    if (fs.existsSync(p)) {
      // Swallowing this would let the DB update below mark the override
      // "cleared" even when the file is still sitting on disk -- and since
      // the endpoint checks that file before it ever looks at image_path,
      // the stale image would keep being served despite the DB saying
      // otherwise. Let a removal failure abort instead of masking it.
      fs.removeSync(p)
    }
  }
  db.prepare(`
    UPDATE artists
    SET image_path = NULL, image_source = ?, image_fetched_at = ?
    WHERE id = ?
  `).run('fallback', Date.now(), artist.id)
  return db.prepare('SELECT * FROM artists WHERE id = ?').get(artist.id) || null
}

async function cacheArtistMetadata(db, artist, options = {}) {
  if (!artist?.id || !artist?.name) return null
  const { fetchImages } = getArtistFetchSettings(db)
  if (!shouldFetchArtistMetadata(artist, fetchImages)) return artist

  const fetched = await fetchArtistMetadata(artist.name, { ...options, source: options.source || getDefaultArtistSource(db) })
  const now = Date.now()

  if (!fetched) {
    if (shouldFetchField(artist.bio, artist.bio_source, artist.bio_fetched_at)) {
      db.prepare(`UPDATE artists SET bio_fetched_at = ? WHERE id = ? AND COALESCE(bio_source, '') != 'manual'`).run(now, artist.id)
    }
    if (fetchImages && shouldFetchField(artist.image_path, artist.image_source, artist.image_fetched_at)) {
      db.prepare(`UPDATE artists SET image_fetched_at = ? WHERE id = ? AND COALESCE(image_source, '') != 'manual'`).run(now, artist.id)
    }
    return db.prepare('SELECT * FROM artists WHERE id = ?').get(artist.id) || artist
  }

  if (shouldFetchField(artist.bio, artist.bio_source, artist.bio_fetched_at)) {
    db.prepare(`
      UPDATE artists
      SET bio = COALESCE(NULLIF(bio, ''), ?),
          bio_source = CASE WHEN COALESCE(NULLIF(bio, ''), '') = '' AND ? IS NOT NULL THEN ? ELSE bio_source END,
          bio_fetched_at = ?
      WHERE id = ? AND COALESCE(bio_source, '') != 'manual'
    `).run(fetched.bio, fetched.bio, fetched.bioSource || fetched.source || 'wikipedia', now, artist.id)
  }

  if (fetchImages && shouldFetchField(artist.image_path, artist.image_source, artist.image_fetched_at)) {
    let imagePath = null
    if (fetched.imageUrl) {
      const dest = path.join(getStorageDir(), 'artwork', `artist-${artist.id}.jpg`)
      try {
        imagePath = await downloadToFile(fetched.imageUrl, dest)
      } catch {}
    }
    db.prepare(`
      UPDATE artists
      SET image_path = COALESCE(image_path, ?),
          image_source = CASE WHEN image_path IS NULL AND ? IS NOT NULL THEN ? ELSE image_source END,
          image_fetched_at = ?
      WHERE id = ? AND COALESCE(image_source, '') != 'manual'
    `).run(imagePath, imagePath, fetched.imageSource || fetched.source || 'wikipedia', now, artist.id)
  }

  return db.prepare('SELECT * FROM artists WHERE id = ?').get(artist.id) || artist
}

/**
 * Fetches an artist's bio and picture again and replaces the ones fetched
 * online before (a bio or picture the user set by hand is kept). A picture is
 * downloaded to a temporary file first, so a failed download never loses the
 * current one. Returns { bio, image }: what was replaced.
 */
async function refreshArtistMetadata(db, artist, { source } = {}) {
  const fetched = await fetchArtistMetadata(artist.name, { source: source || getDefaultArtistSource(db) })
  const now = Date.now()
  const done = { bio: false, image: false }
  if (fetched?.bio && artist.bio_source !== 'manual') {
    db.prepare(`UPDATE artists SET bio = ?, bio_source = ?, bio_fetched_at = ? WHERE id = ? AND COALESCE(bio_source, '') != 'manual'`)
      .run(fetched.bio, fetched.bioSource || fetched.source || 'wikipedia', now, artist.id)
    done.bio = true
  }
  if (fetched?.imageUrl && artist.image_source !== 'manual' && getArtistFetchSettings(db).fetchImages) {
    const dest = path.join(getStorageDir(), 'artwork', `artist-${artist.id}.jpg`)
    const tmp = `${dest}.download`
    try {
      await downloadToFile(fetched.imageUrl, tmp)
      await fs.move(tmp, dest, { overwrite: true })
      db.prepare(`UPDATE artists SET image_path = ?, image_source = ?, image_fetched_at = ? WHERE id = ? AND COALESCE(image_source, '') != 'manual'`)
        .run(dest, fetched.imageSource || fetched.source || 'wikipedia', now, artist.id)
      done.image = true
    } catch {
      fs.remove(tmp).catch(() => {})
    }
  }
  return done
}

// ---------------------------------------------------------------- refresh all
// One background job for the whole library (Artists > Refresh artist info),
// shared by the desktop app and the web server; the page polls its status.
// MusicBrainz asks for at most one request a second, so artists are done one
// at a time with a pause when it's involved.
const refreshAll = { running: false, cancel: false, source: null, total: 0, done: 0, bios: 0, images: 0, failed: 0, startedAt: 0, finishedAt: 0 }

function refreshAllStatus() {
  const { cancel, ...status } = refreshAll
  return { ...status }
}

function startRefreshAll(db, { source } = {}) {
  if (refreshAll.running) return refreshAllStatus()
  const chosen = normalizeSource(source || getDefaultArtistSource(db))
  const artists = db.prepare(`
    SELECT a.* FROM artists a
    WHERE EXISTS (SELECT 1 FROM artist_track_links l JOIN tracks t ON t.id = l.track_id WHERE l.artist_id = a.id AND t.file_path NOT LIKE 'ghost://%')
    ORDER BY a.name COLLATE NOCASE
  `).all()
  Object.assign(refreshAll, { running: true, cancel: false, source: chosen, total: artists.length, done: 0, bios: 0, images: 0, failed: 0, startedAt: Date.now(), finishedAt: 0 })
  // MusicBrainz: one request a second. TheAudioDB paces itself (audioDbGet).
  const gapMs = chosen === 'wikipedia' || chosen === 'deezer' || chosen === 'theaudiodb' ? 250 : 1100
  ;(async () => {
    try {
      for (const artist of artists) {
        if (refreshAll.cancel) break
        if (artist.bio_source === 'manual' && artist.image_source === 'manual') { refreshAll.done++; continue }
        try {
          const done = await refreshArtistMetadata(db, artist, { source: chosen })
          if (done.bio) refreshAll.bios++
          if (done.image) refreshAll.images++
        } catch {
          refreshAll.failed++
        }
        refreshAll.done++
        await new Promise(resolve => setTimeout(resolve, gapMs))
      }
    } finally {
      refreshAll.running = false
      refreshAll.finishedAt = Date.now()
    }
  })().catch((error) => console.warn('[artists] Refresh all stopped:', error?.message))
  return refreshAllStatus()
}

function cancelRefreshAll() {
  if (refreshAll.running) refreshAll.cancel = true
  return refreshAllStatus()
}

module.exports = {
  refreshArtistMetadata,
  startRefreshAll,
  refreshAllStatus,
  cancelRefreshAll,
  getDefaultArtistSource,
  applyArtistMetadataSelection,
  cacheArtistMetadata,
  clearArtistImageOverride,
  getArtistFetchSettings,
  searchArtistMetadataCandidates,
}
