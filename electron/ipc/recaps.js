const { getDB } = require('./db')

const QUALIFIED_SECONDS = 30
const SESSION_GAP_SECONDS = 30 * 60
const FALLBACK_GENRES = new Set(['music'])
// Library files and songs streamed from search (YouTube Music, SoundCloud,
// addons); other ghost tracks (imported, not playable) can't have plays.
const STREAMED_TRACKS = "(t.file_path LIKE 'ghost://youtube/online/%' OR t.file_path LIKE 'ghost://soundcloud/online/%' OR t.file_path LIKE 'ghost://addon/%')"
const LIBRARY_TRACKS = "t.file_path NOT LIKE 'ghost://%'"
const COUNTED_TRACKS = `(${LIBRARY_TRACKS} OR ${STREAMED_TRACKS})`

/**
 * The songs a recap counts (opts.sources): 'library' for files only,
 * 'streamed' for songs only streamed, anything else for both. A streamed song
 * downloaded since counts as the library's (its plays moved to the file).
 */
function countedTracks(sources) {
  if (sources === 'library') return LIBRARY_TRACKS
  if (sources === 'streamed') return STREAMED_TRACKS
  return COUNTED_TRACKS
}

function toUnix(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value)
  const parsed = Date.parse(String(value))
  if (Number.isNaN(parsed)) return fallback
  return Math.floor(parsed / 1000)
}

function startOfYear(year) {
  return Math.floor(new Date(Number(year), 0, 1).getTime() / 1000)
}

function endOfYear(year) {
  return Math.floor(new Date(Number(year) + 1, 0, 1).getTime() / 1000) - 1
}

function quarterRange(year, quarter) {
  const q = Math.min(4, Math.max(1, Number(quarter) || 1))
  const startMonth = (q - 1) * 3
  return {
    from: Math.floor(new Date(Number(year), startMonth, 1).getTime() / 1000),
    to: Math.floor(new Date(Number(year), startMonth + 3, 1).getTime() / 1000) - 1,
  }
}

/** A usable IANA time zone name ("Europe/Paris"), or null. */
function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz } catch { return null }
}

/** How far `tz` is ahead of UTC at the instant `ms`, in ms. */
function zoneOffsetMs(ms, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map(p => [p.type, p.value]))
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/**
 * The hour of day (0-23) a play at `seconds` happened at in `tz` (the
 * server's own zone without one). The zone's offset is looked up once per
 * hour of plays, not once per play.
 */
function hourInZone(tz) {
  const offsets = new Map()
  return (seconds) => {
    const ms = Number(seconds) * 1000
    if (!tz) return new Date(ms).getHours()
    const bucket = Math.floor(ms / 3600000)
    if (!offsets.has(bucket)) offsets.set(bucket, zoneOffsetMs(bucket * 3600000, tz))
    return new Date(ms + offsets.get(bucket)).getUTCHours()
  }
}

/** The instant (ms) of midnight starting y-m-d in `tz` (the server's own zone without one). */
function midnightMs(y, m, d, tz) {
  if (!tz) return new Date(y, m - 1, d).getTime()
  const guess = Date.UTC(y, m - 1, d)
  // Twice: the offset at the first guess can differ from the one at midnight (DST).
  let ms = guess - zoneOffsetMs(guess, tz)
  ms = guess - zoneOffsetMs(ms, tz)
  return ms
}

/**
 * A week from its Monday ("2026-09-21"): Monday 00:00 to Sunday 23:59:59 in
 * the listener's time zone (`tz`, from the player; the server's if absent).
 * Null for anything but a real date that is a Monday.
 */
function weekRange(weekStart, tz) {
  const m = String(weekStart || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  // A date JavaScript would roll over (2026-02-31 → March 3) isn't a date.
  const day = new Date(Date.UTC(y, mo - 1, d))
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return null
  if (day.getUTCDay() !== 1) return null // weeks start on Monday
  const next = new Date(Date.UTC(y, mo - 1, d + 7))
  const zone = validTimeZone(tz)
  const from = midnightMs(y, mo, d, zone)
  const to = midnightMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), zone)
  return { from: Math.floor(from / 1000), to: Math.floor(to / 1000) - 1, year: y, weekStart: m[0], tz: zone }
}

/**
 * A calendar month (1-12) of `year`, from the 1st 00:00 to the last day's
 * 23:59:59 in the listener's time zone (`tz`; the server's if absent).
 * Null unless year and month are whole numbers in range.
 */
function monthRange(year, month, tz) {
  const y = Number(year)
  const m = Number(month)
  if (!Number.isInteger(y) || y < 1970 || y > 9999 || !Number.isInteger(m) || m < 1 || m > 12) return null
  const zone = validTimeZone(tz)
  const next = m === 12 ? [y + 1, 1] : [y, m + 1]
  const from = midnightMs(y, m, 1, zone)
  const to = midnightMs(next[0], next[1], 1, zone)
  return { from: Math.floor(from / 1000), to: Math.floor(to / 1000) - 1, year: y, month: m, tz: zone }
}

function resolveRange(opts = {}) {
  const now = new Date()
  const currentYear = now.getFullYear()
  if (opts.scope === 'week') {
    const week = weekRange(opts.weekStart, opts.tz)
    // Never fall back to another range for a bad week.
    return week ? { ...week, scope: 'week' } : { error: 'Invalid week: weekStart must be a Monday (YYYY-MM-DD).' }
  }
  if (opts.scope === 'month') {
    const month = monthRange(opts.year, opts.month, opts.tz)
    return month ? { ...month, scope: 'month' } : { error: 'Invalid month: year and month (1-12) are needed.' }
  }
  if (opts.scope === 'quarter') {
    const q = opts.quarter || Math.floor(now.getMonth() / 3) + 1
    return { ...quarterRange(opts.year || currentYear, q), scope: 'quarter', year: Number(opts.year || currentYear), quarter: Number(q) }
  }
  if (opts.scope === 'year') {
    const year = Number(opts.year || currentYear)
    const zone = validTimeZone(opts.tz)
    // In the listener's time zone, like weeks and months (the days listed come from it too).
    if (zone && Number.isInteger(year) && year >= 1970 && year <= 9999) {
      return { from: Math.floor(midnightMs(year, 1, 1, zone) / 1000), to: Math.floor(midnightMs(year + 1, 1, 1, zone) / 1000) - 1, scope: 'year', year, tz: zone }
    }
    return { from: startOfYear(year), to: endOfYear(year), scope: 'year', year }
  }
  const from = toUnix(opts.from, 0)
  const to = toUnix(opts.to, Math.floor(Date.now() / 1000))
  return { from, to, scope: 'custom' }
}

function ensureRecapTables(db = getDB()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listening_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_type TEXT,
      source_id TEXT,
      session_id TEXT,
      seconds_played INTEGER DEFAULT 0,
      track_duration REAL,
      started_at INTEGER,
      ended_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_le_user_time ON listening_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_le_session ON listening_events(session_id);
  `)
  try { db.exec('ALTER TABLE play_history ADD COLUMN session_id TEXT') } catch {}
}

function getSessionId(db, userId, endedAt) {
  ensureRecapTables(db)
  const last = db.prepare(`
    SELECT session_id, played_at
    FROM play_history
    WHERE user_id = ? AND session_id IS NOT NULL
    ORDER BY played_at DESC
    LIMIT 1
  `).get(userId)
  if (last?.session_id && endedAt - Number(last.played_at || 0) <= SESSION_GAP_SECONDS) return last.session_id
  return `ls-${userId}-${endedAt}-${Math.random().toString(36).slice(2, 8)}`
}

function recordListeningEvent(db, payload = {}) {
  ensureRecapTables(db)
  const userId = payload.userId || payload.user_id || 'guest'
  const trackId = payload.trackId || payload.track_id
  if (!trackId) return null
  const seconds = Math.max(0, Math.round(Number(payload.secondsPlayed ?? payload.seconds_played ?? payload.seconds ?? 0) || 0))
  const endedAt = Math.floor(Number(payload.endedAt || payload.ended_at || Date.now() / 1000))
  const startedAt = Math.max(0, Math.floor(Number(payload.startedAt || payload.started_at || endedAt - seconds)))
  const eventType = payload.eventType || payload.event_type || (seconds >= QUALIFIED_SECONDS ? 'qualified_play' : 'skipped')
  const sessionId = payload.sessionId || payload.session_id || getSessionId(db, userId, endedAt)
  db.prepare(`
    INSERT INTO listening_events
    (user_id, track_id, event_type, source_type, source_id, session_id, seconds_played, track_duration, started_at, ended_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    trackId,
    eventType,
    payload.sourceType || payload.source_type || null,
    payload.sourceId || payload.source_id || null,
    sessionId,
    seconds,
    payload.trackDuration || payload.track_duration || null,
    startedAt,
    endedAt,
    endedAt
  )
  return sessionId
}

function splitGenres(track) {
  return String(track?.genres || track?.genre || '')
    .split(',')
    .map(part => part.trim())
    .filter(genre => genre && !FALLBACK_GENRES.has(genre.toLowerCase()))
}

function incrementMap(map, key, amount = 1) {
  if (!key) return
  map.set(key, (map.get(key) || 0) + amount)
}

function topFromMap(map, keyName, limit = 10) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([key, plays]) => ({ [keyName]: key, plays }))
}

function avg(values) {
  const nums = values.map(Number).filter(Number.isFinite)
  if (!nums.length) return null
  return nums.reduce((sum, value) => sum + value, 0) / nums.length
}

function labelSession(session) {
  const hour = new Date(session.start * 1000).getHours()
  const topGenre = session.topGenres[0]?.genre
  const topArtist = session.topArtists[0]?.artist
  const genreShare = session.trackCount ? (session.topGenres[0]?.plays || 0) / session.trackCount : 0
  const artistShare = session.trackCount ? (session.topArtists[0]?.plays || 0) / session.trackCount : 0
  const skipRate = session.trackCount ? session.skippedCount / session.trackCount : 0
  if (skipRate >= 0.45 && session.trackCount >= 5) return 'Discovery pass'
  if ((hour >= 23 || hour < 5) && Number(session.audio.energy || 0) < 0.55) return 'Late night listening'
  if (genreShare >= 0.45 && topGenre) return `${session.durationMinutes || 1}-minute ${topGenre} run`
  if (artistShare >= 0.5 && topArtist) return `${topArtist} deep dive`
  if (Number(session.audio.energy || 0) >= 0.72 || Number(session.audio.tempo || 0) >= 135) return 'High-energy streak'
  return 'Listening session'
}

function buildSessions(rows) {
  const sessions = []
  let current = null
  for (const row of rows) {
    const playedAt = Number(row.played_at || 0)
    if (!current || playedAt - current.lastPlayedAt > SESSION_GAP_SECONDS) {
      current = { start: playedAt, end: playedAt, lastPlayedAt: playedAt, rows: [] }
      sessions.push(current)
    }
    current.rows.push(row)
    current.end = Math.max(current.end, playedAt + Number(row.seconds_played || 0))
    current.lastPlayedAt = playedAt
  }
  return sessions.map((session, index) => {
    const artistMap = new Map()
    const genreMap = new Map()
    const albumMap = new Map()
    const tracks = []
    const seen = new Set()
    for (const row of session.rows) {
      incrementMap(artistMap, row.artist)
      incrementMap(albumMap, row.album)
      for (const genre of splitGenres(row)) incrementMap(genreMap, genre)
      if (!seen.has(row.id)) {
        tracks.push(row)
        seen.add(row.id)
      }
    }
    const audio = {
      energy: avg(session.rows.map(row => row.energy)),
      danceability: avg(session.rows.map(row => row.danceability)),
      valence: avg(session.rows.map(row => row.valence)),
      acousticness: avg(session.rows.map(row => row.acousticness)),
      instrumentalness: avg(session.rows.map(row => row.instrumentalness)),
      tempo: avg(session.rows.map(row => row.tempo)),
    }
    const item = {
      id: session.rows.find(row => row.session_id)?.session_id || `derived-${index}-${session.start}`,
      start: session.start,
      end: session.end,
      durationMinutes: Math.max(1, Math.round((session.end - session.start) / 60)),
      trackCount: session.rows.length,
      qualifiedCount: session.rows.filter(row => Number(row.seconds_played || 0) >= QUALIFIED_SECONDS).length,
      skippedCount: session.rows.filter(row => Number(row.seconds_played || 0) < QUALIFIED_SECONDS).length,
      totalSeconds: session.rows.reduce((sum, row) => sum + Number(row.seconds_played || 0), 0),
      topArtists: topFromMap(artistMap, 'artist', 5),
      topGenres: topFromMap(genreMap, 'genre', 5),
      topAlbums: topFromMap(albumMap, 'album', 5).filter(item => item.album),
      audio,
      tracks: tracks.slice(0, 50),
    }
    return { ...item, label: labelSession(item) }
  }).sort((left, right) => right.totalSeconds - left.totalSeconds)
}

function savePreferenceProfile(db, userId, rows) {
  const genreMap = new Map()
  const artistMap = new Map()
  const hourMap = new Map()
  const skippedGenres = new Map()
  const qualified = rows.filter(row => Number(row.seconds_played || 0) >= QUALIFIED_SECONDS)
  for (const row of rows) {
    const hour = new Date(Number(row.played_at || 0) * 1000).getHours()
    incrementMap(hourMap, String(hour), 1)
    const genres = splitGenres(row)
    if (Number(row.seconds_played || 0) >= QUALIFIED_SECONDS) {
      incrementMap(artistMap, row.artist, 1)
      for (const genre of genres) incrementMap(genreMap, genre, 1)
    } else {
      for (const genre of genres) incrementMap(skippedGenres, genre, 1)
    }
  }
  const profile = {
    updatedAt: Math.floor(Date.now() / 1000),
    favoriteGenres: topFromMap(genreMap, 'genre', 12),
    skippedGenres: topFromMap(skippedGenres, 'genre', 12),
    favoriteArtists: topFromMap(artistMap, 'artist', 12),
    favoriteHours: topFromMap(hourMap, 'hour', 6).map(item => ({ hour: Number(item.hour), plays: item.plays })),
    audio: {
      energy: avg(qualified.map(row => row.energy)),
      danceability: avg(qualified.map(row => row.danceability)),
      valence: avg(qualified.map(row => row.valence)),
      acousticness: avg(qualified.map(row => row.acousticness)),
      instrumentalness: avg(qualified.map(row => row.instrumentalness)),
      tempo: avg(qualified.map(row => row.tempo)),
    },
  }
  db.prepare('INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)').run(userId, 'listening_preferences', JSON.stringify(profile))
  return profile
}

function buildRecap(db, userId = 'guest', opts = {}) {
  ensureRecapTables(db)
  const range = resolveRange(opts)
  if (range.error) return { error: range.error }
  const now = Math.floor(Date.now() / 1000)
  if (['week', 'month', 'quarter', 'year'].includes(range.scope) && range.to >= now) {
    // A month or year still going can be asked for "so far" (partial=1): up to now.
    const partial = ['1', 'true'].includes(String(opts.partial)) && ['month', 'year'].includes(range.scope) && range.from <= now
    if (!partial) return { error: 'This recap period has not finished yet.' }
    range.to = now
    range.partial = true
  }
  try { db.exec('ALTER TABLE play_history ADD COLUMN seconds_played INTEGER DEFAULT 0') } catch {}
  const COUNTED = countedTracks(opts.sources)
  // Just "is there anything?" (period lists, the sidebar badge): no full recap.
  if (['1', 'true'].includes(String(opts.countOnly))) {
    const { n } = db.prepare(`
      SELECT COUNT(*) AS n FROM play_history ph JOIN tracks t ON t.id = ph.track_id
      WHERE ph.user_id = ? AND ph.played_at BETWEEN ? AND ? AND COALESCE(ph.seconds_played, 0) >= ? AND ${COUNTED}
    `).get(userId, range.from, range.to, QUALIFIED_SECONDS)
    return { ...range, userId, totalPlays: n }
  }
  const rows = db.prepare(`
    SELECT t.*, ph.id as history_id, ph.played_at, COALESCE(ph.seconds_played, 0) as seconds_played, ph.session_id
    FROM play_history ph
    JOIN tracks t ON t.id = ph.track_id
    WHERE ph.user_id = ?
      AND ph.played_at BETWEEN ? AND ?
      AND ${COUNTED}
    ORDER BY ph.played_at ASC
  `).all(userId, range.from, range.to)
  const qualified = rows.filter(row => Number(row.seconds_played || 0) >= QUALIFIED_SECONDS)
  const trackMap = new Map()
  const artistMap = new Map()
  const genreMap = new Map()
  const albumMap = new Map()
  const skippedMap = new Map()
  for (const row of qualified) {
    const existing = trackMap.get(row.id) || { ...row, plays: 0, seconds: 0 }
    existing.plays += 1
    existing.seconds += Number(row.seconds_played || 0)
    trackMap.set(row.id, existing)
    incrementMap(artistMap, row.artist)
    incrementMap(albumMap, row.album)
    for (const genre of splitGenres(row)) incrementMap(genreMap, genre)
  }
  for (const row of rows.filter(row => Number(row.seconds_played || 0) < QUALIFIED_SECONDS)) {
    const existing = skippedMap.get(row.id) || { ...row, skips: 0 }
    existing.skips += 1
    skippedMap.set(row.id, existing)
  }
  const sessions = buildSessions(rows)
  const topTracks = [...trackMap.values()].sort((left, right) => right.plays - left.plays || right.seconds - left.seconds).slice(0, 50)
  const replayQueue = topTracks.slice(0, 50)
  const totalSeconds = qualified.reduce((sum, row) => sum + Number(row.seconds_played || 0), 0)
  // The listening profile is of all the listening, not of one filter's share.
  const filtered = COUNTED !== COUNTED_TRACKS
  const preferenceProfile = filtered ? null : savePreferenceProfile(db, userId, rows)
  // Plays per hour of the day, in the listener's time zone (SQLite's
  // 'localtime' is the server's, which the web version may not share).
  const hourOf = hourInZone(validTimeZone(opts.tz))
  const hours = Array(24).fill(0)
  for (const row of qualified) hours[hourOf(row.played_at)] += 1
  const busiest = hours.reduce((best, plays, hour) => (plays > best.plays ? { hour, plays } : best), { hour: null, plays: 0 })
  const peakHour = busiest.plays ? busiest : null
  return {
    ...range,
    userId,
    totalPlays: qualified.length,
    totalSkips: rows.length - qualified.length,
    totalMinutes: Math.round(totalSeconds / 60),
    uniqueArtists: new Set(qualified.map(row => row.artist).filter(Boolean)).size,
    uniqueAlbums: new Set(qualified.map(row => row.album || row.id).filter(Boolean)).size,
    uniqueTracks: new Set(qualified.map(row => row.id)).size,
    topTracks,
    topArtists: topFromMap(artistMap, 'artist', 10),
    topGenres: topFromMap(genreMap, 'genre', 10),
    topAlbums: topFromMap(albumMap, 'album', 10).filter(item => item.album),
    skippedTracks: [...skippedMap.values()].sort((left, right) => right.skips - left.skips).slice(0, 10),
    sessions: sessions.slice(0, 12),
    longestSession: [...sessions].sort((left, right) => right.durationMinutes - left.durationMinutes)[0] || null,
    biggestSession: sessions[0] || null,
    replayQueue,
    peakHour,
    hours,
    preferences: preferenceProfile,
  }
}

/**
 * The songs one artist or genre of a recap was played for (opts.artist or
 * opts.genre, as the recap names them), most played first: what the Recap
 * page plays or saves as a playlist from its Top Artists and Genres.
 */
function recapTracks(db, userId = 'guest', opts = {}) {
  ensureRecapTables(db)
  const range = resolveRange(opts)
  if (range.error) return { error: range.error }
  const artist = typeof opts.artist === 'string' && opts.artist ? opts.artist : null
  const genre = typeof opts.genre === 'string' && opts.genre ? opts.genre.toLowerCase() : null
  if (!artist && !genre) return { error: 'An artist or a genre is needed.' }
  const rows = db.prepare(`
    SELECT t.*, ph.played_at, COALESCE(ph.seconds_played, 0) as seconds_played
    FROM play_history ph
    JOIN tracks t ON t.id = ph.track_id
    WHERE ph.user_id = ? AND ph.played_at BETWEEN ? AND ? AND COALESCE(ph.seconds_played, 0) >= ? AND ${countedTracks(opts.sources)}
  `).all(userId, range.from, range.to, QUALIFIED_SECONDS)
  const matches = artist
    ? (row) => row.artist === artist
    : (row) => splitGenres(row).some(name => name.toLowerCase() === genre)
  const byTrack = new Map()
  for (const row of rows) {
    if (!matches(row)) continue
    const entry = byTrack.get(row.id) || { ...row, plays: 0, seconds: 0 }
    entry.plays += 1
    entry.seconds += Number(row.seconds_played || 0)
    byTrack.set(row.id, entry)
  }
  const tracks = [...byTrack.values()]
    .sort((left, right) => right.plays - left.plays || right.seconds - left.seconds)
    .slice(0, 100)
    .map(({ played_at, seconds_played, ...track }) => track)
  return { tracks }
}

/**
 * The days (YYYY-MM-DD, in the listener's time zone `tz`) with at least one
 * counted play: what the Recap page needs to offer only the years, months
 * and weeks that have something in them. Plays are bucketed by hour first
 * (one date lookup per hour, not per play); both ends of each hour are
 * looked at, so half-hour time zones don't lose a day at midnight.
 */
function listeningDays(db, userId = 'guest', opts = {}) {
  ensureRecapTables(db)
  try { db.exec('ALTER TABLE play_history ADD COLUMN seconds_played INTEGER DEFAULT 0') } catch {}
  const zone = validTimeZone(opts.tz)
  const hours = db.prepare(`
    SELECT DISTINCT CAST(ph.played_at / 3600 AS INTEGER) AS h
    FROM play_history ph JOIN tracks t ON t.id = ph.track_id
    WHERE ph.user_id = ? AND COALESCE(ph.seconds_played, 0) >= ? AND ${countedTracks(opts.sources)}
  `).all(userId, QUALIFIED_SECONDS).map(row => row.h)
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' })
  const days = new Set()
  for (const h of hours) {
    days.add(format.format(new Date(h * 3600 * 1000)))
    days.add(format.format(new Date((h * 3600 + 3599) * 1000)))
  }
  return { days: [...days].sort(), tz: zone }
}

function registerRecapHandlers(ipcMain) {
  ipcMain.handle('recaps:days', (_, userId, opts) => listeningDays(getDB(), userId || 'guest', opts || {}))
  ipcMain.handle('recaps:get', (_, userId, opts) => buildRecap(getDB(), userId || 'guest', opts || {}))
  ipcMain.handle('recaps:tracks', (_, userId, opts) => recapTracks(getDB(), userId || 'guest', opts || {}))
  ipcMain.handle('recaps:getPreferences', (_, userId) => {
    const row = getDB().prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'listening_preferences'").get(userId || 'guest')
    try { return row?.value ? JSON.parse(row.value) : null } catch { return null }
  })
}

module.exports = { registerRecapHandlers, recordListeningEvent, buildRecap, recapTracks, listeningDays, ensureRecapTables }
