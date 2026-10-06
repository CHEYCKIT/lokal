// Genres for streamed songs (YouTube Music, SoundCloud, addons): the sources
// rarely say one, so it's looked up on iTunes, like the library's "Fetch
// missing genres", and kept on the song. Recaps (Top Genres, sessions) and the
// details panel read it from there. Off with "Fetch Online Artwork" (the same
// iTunes/MusicBrainz lookups for the library).

const STREAMED = "(file_path LIKE 'ghost://youtube/online/%' OR file_path LIKE 'ghost://soundcloud/online/%' OR file_path LIKE 'ghost://addon/%')"
const GAP_MS = 300

// Songs already looked up this run (found or not): not asked again.
const looked = new Map()
let queue = Promise.resolve()

const plain = value => String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/\b(feat|ft|featuring|with)\b.*$/, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** The song's own name, without "(Remastered 2004)", "- Live" and the like. */
const bareTitle = title => String(title || '').replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim() || String(title || '')

function enabled(db) {
  try { return db.prepare("SELECT value FROM settings WHERE key = 'fetch_online_artwork'").get()?.value !== '0' } catch { return true }
}

/**
 * The genre iTunes gives the song `title` by `artist`, or null. Only a result
 * by that artist counts (a cover or a namesake's song would bring its genre).
 */
async function itunesGenre(title, artist, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const name = String(title || '').trim()
  const by = String(artist || '').trim()
  if (!name || !by) return null
  const lead = plain(by.split(/,|&| x | and /i)[0]) || plain(by)
  const term = `${by} ${bareTitle(name)}`.slice(0, 200)
  const res = await fetchImpl(`https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'song', limit: '10' })}`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res?.ok) return null
  const data = await res.json().catch(() => null)
  const results = Array.isArray(data?.results) ? data.results : []
  const byArtist = results.filter(result => {
    const found = plain(result.artistName)
    return found && (found === plain(by) || found.includes(lead) || lead.includes(found))
  })
  const want = plain(bareTitle(name))
  const pick = byArtist.find(result => plain(bareTitle(result.trackName)) === want) || byArtist[0]
  const genre = typeof pick?.primaryGenreName === 'string' ? pick.primaryGenreName.trim().slice(0, 100) : ''
  return genre || null
}

/** Look up and keep one streamed song's genre (once per run); its genre, or null. */
async function lookupGenre(db, row, options = {}) {
  if (!row?.id) return null
  if (row.genre) return row.genre
  if (looked.has(row.id)) return looked.get(row.id)
  if (!enabled(db)) return null
  const pending = (async () => {
    const genre = await itunesGenre(row.title, row.artist, options).catch(() => null)
    if (genre) {
      try { db.prepare(`UPDATE tracks SET genre = ? WHERE id = ? AND (genre IS NULL OR genre = '') AND ${STREAMED}`).run(genre, row.id) } catch {}
    }
    return genre
  })()
  looked.set(row.id, pending)
  const genre = await pending
  looked.set(row.id, genre)
  return genre
}

/** In the background, one at a time: the genres of the streamed songs among `rows` that have none. */
function fillOnlineGenres(db, rows = [], options = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter(row => row?.id && !row.genre && /^ghost:\/\/(youtube\/online|soundcloud\/online|addon)\//.test(String(row.file_path || '')) && !looked.has(row.id))
  if (!list.length || !enabled(db)) return queue
  queue = queue.then(async () => {
    for (const row of list) {
      if (looked.has(row.id)) continue
      await lookupGenre(db, row, options)
      await new Promise(resolve => setTimeout(resolve, options.gapMs ?? GAP_MS))
    }
  }).catch(() => {})
  return queue
}

/** The streamed songs with plays but no genre (streamed before this was looked up). */
function backfillOnlineGenres(db, { limit = 300, ...options } = {}) {
  let rows = []
  try {
    rows = db.prepare(`
      SELECT t.id, t.title, t.artist, t.genre, t.file_path FROM tracks t
      WHERE (t.genre IS NULL OR t.genre = '') AND ${STREAMED.replace(/file_path/g, 't.file_path')}
        AND EXISTS (SELECT 1 FROM play_history ph WHERE ph.track_id = t.id)
      LIMIT ?
    `).all(limit)
  } catch {}
  return fillOnlineGenres(db, rows, options)
}

/** One streamed song's genre, looked up now if it has none (the details panel). */
async function trackGenre(db, trackId, options = {}) {
  let row = null
  try { row = db.prepare(`SELECT id, title, artist, genre, file_path FROM tracks WHERE id = ? AND ${STREAMED}`).get(String(trackId || '')) } catch {}
  if (!row) return null
  return lookupGenre(db, row, options)
}

/**
 * The genre iTunes gives the album `album` by `artist`, or null; only an
 * album by that artist counts, the same title first.
 */
async function itunesAlbumGenre(album, artist, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const name = String(album || '').trim()
  const by = String(artist || '').trim()
  if (!name || !by) return null
  const lead = plain(by.split(/,|&| x | and /i)[0]) || plain(by)
  const res = await fetchImpl(`https://itunes.apple.com/search?${new URLSearchParams({ term: `${by} ${bareTitle(name)}`.slice(0, 200), entity: 'album', limit: '10' })}`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res?.ok) return null
  const data = await res.json().catch(() => null)
  const byArtist = (Array.isArray(data?.results) ? data.results : []).filter(result => {
    const found = plain(result.artistName)
    return found && (found === plain(by) || found.includes(lead) || lead.includes(found))
  })
  const want = plain(bareTitle(name))
  const pick = byArtist.find(result => plain(bareTitle(result.collectionName)) === want)
  const genre = typeof pick?.primaryGenreName === 'string' ? pick.primaryGenreName.trim().slice(0, 100) : ''
  return genre || null
}

// Settings > Library > Fill In Genres: every song without a genre (files and
// streamed songs), one lookup per album (a song on its own: by its title).
// iTunes answers about 20 searches a minute, so lookups are paced to that
// and run in the background; the page reads the progress (libraryGenresStatus).
const ITUNES_GAP_MS = 3200
let libraryJob = null

function libraryGenreGroups(db) {
  const rows = db.prepare(`
    SELECT id, title, artist, album, album_artist FROM tracks
    WHERE (genre IS NULL OR genre = '') AND (file_path NOT LIKE 'ghost://%' OR ${STREAMED})
  `).all()
  const groups = new Map()
  for (const row of rows) {
    const artist = row.album_artist || row.artist || ''
    const key = row.album ? `album\0${plain(artist)}\0${plain(bareTitle(row.album))}` : `song\0${row.id}`
    if (!groups.has(key)) groups.set(key, { album: row.album || null, artist, title: row.title, artistOfSong: row.artist, ids: [] })
    groups.get(key).ids.push(row.id)
  }
  return [...groups.values()]
}

/** Start filling in genres (unless already running); its status. */
function startLibraryGenres(db, { fetchImpl = fetch, gapMs = ITUNES_GAP_MS } = {}) {
  if (libraryJob?.running) return libraryGenresStatus()
  if (!enabled(db)) return { error: 'Turn on "Look Up Missing Info" first.' }
  const groups = libraryGenreGroups(db)
  const job = libraryJob = { running: true, total: groups.length, done: 0, updated: 0, songs: groups.reduce((sum, group) => sum + group.ids.length, 0) }
  ;(async () => {
    for (const group of groups) {
      try {
        const genre = (group.album ? await itunesAlbumGenre(group.album, group.artist, { fetchImpl }).catch(() => null) : null)
          || await itunesGenre(group.title, group.artistOfSong || group.artist, { fetchImpl }).catch(() => null)
        if (genre) {
          const update = db.prepare("UPDATE tracks SET genre = ? WHERE id = ? AND (genre IS NULL OR genre = '')")
          for (const id of group.ids) job.updated += update.run(genre, id).changes || 0
        }
      } catch {}
      job.done += 1
      if (job.done < groups.length) await new Promise(resolve => setTimeout(resolve, gapMs))
    }
    job.running = false
  })()
  return libraryGenresStatus()
}

/** { running, total (albums and loose songs), done, songs (without a genre at the start), updated (songs given one) } */
function libraryGenresStatus() {
  return libraryJob ? { ...libraryJob } : { running: false, total: 0, done: 0, songs: 0, updated: 0 }
}

module.exports = { itunesGenre, itunesAlbumGenre, fillOnlineGenres, backfillOnlineGenres, trackGenre, startLibraryGenres, libraryGenresStatus, _forget: () => looked.clear() }
