// Last.fm scrobbling and "now playing", shared by the desktop app (IPC) and
// the web server so they behave the same:
//   - requests are signed as Last.fm specifies ("format" is NOT part of the
//     signature -- the web server used to include it, so every signed call
//     from web mode was rejected with "Invalid method signature");
//   - the main artist is sent, with "Tyler, The Creator"-style exceptions;
//   - a placeholder album ("Unknown Album") isn't sent;
//   - a scrobble that can't be sent right now (offline, Last.fm down or rate
//     limiting) is queued and sent later in batches, instead of being lost;
//   - a scrobble Last.fm accepts but ignores is reported as such.
//
// API: https://www.last.fm/api/scrobbling

const crypto = require('crypto')

const API_ROOT = 'https://ws.audioscrobbler.com/2.0/'
const BATCH = 50            // Last.fm's maximum per track.scrobble call
const QUEUE_LIMIT = 5000
const MAX_AGE_S = 14 * 24 * 3600 // Last.fm ignores scrobbles older than two weeks
// Errors worth retrying later: 11 service offline, 16 temporarily unavailable, 29 rate limit.
const RETRYABLE = new Set([11, 16, 29])
// Credential/config problems the user can fix (4 auth failed, 9 session expired,
// 10 bad API key, 13 bad signature/secret, 26 suspended key): keep the
// scrobbles so they're sent once Last.fm is reconnected, rather than drop them.
const NEEDS_USER = new Set([4, 9, 10, 13, 26])

const DEFAULT_KEEP_COMMA = [
  'tyler, the creator', 'earth, wind & fire', 'crosby, stills & nash',
  'crosby, stills, nash & young', 'simon & garfunkel', 'emerson, lake & palmer',
  'syd barrett', 'pete & bas', 'pe & ne',
]

function keepCommaArtists(db) {
  const keep = new Set(DEFAULT_KEEP_COMMA)
  try {
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'keep_comma_artists'").get()?.value
    if (raw) JSON.parse(raw).forEach(a => keep.add(String(a || '').toLowerCase().trim()))
  } catch {}
  return keep
}

/** "A, B" -> "A", unless the whole name is a known comma name. */
function primaryArtist(db, artist) {
  const raw = String(artist || '').trim()
  if (!raw) return ''
  if (keepCommaArtists(db).has(raw.toLowerCase())) return raw
  return raw.split(',')[0].trim() || raw
}

/** Last.fm's api_sig: every parameter except format/callback, sorted, then the secret. */
function sign(params, secret) {
  const str = Object.keys(params)
    .filter(k => k !== 'format' && k !== 'callback')
    .sort()
    .map(k => k + params[k])
    .join('') + secret
  return crypto.createHash('md5').update(str, 'utf8').digest('hex')
}

function settingsOf(db) {
  const get = (key) => { try { return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '' } catch { return '' } }
  return {
    apiKey: get('lastfm_api_key'),
    apiSecret: get('lastfm_api_secret'),
    sessionKey: get('lastfm_session_key'),
    enabled: get('lastfm_enabled') !== '0',
    scrobbling: get('lastfm_scrobbling') === '1',
  }
}

/** A signed POST. Resolves to Last.fm's JSON, or { networkError } when it couldn't be reached. */
async function signedCall(method, params, { apiKey, apiSecret }, timeoutMs = 15000) {
  const all = { method, api_key: apiKey, ...params }
  all.api_sig = sign(all, apiSecret)
  all.format = 'json'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(API_ROOT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'LokalMusic/4.0' },
      body: new URLSearchParams(all).toString(),
      signal: controller.signal,
    })
    const json = await res.json().catch(() => null)
    if (!json) return { networkError: `Last.fm answered ${res.status}` }
    return json
  } catch (e) {
    return { networkError: e.name === 'AbortError' ? 'timed out' : e.message }
  } finally {
    clearTimeout(timer)
  }
}

const NO_ALBUM = /^\s*(?:unknown album|unknown)?\s*$/i
const albumOf = (album) => { const a = String(album || '').trim(); return a && !NO_ALBUM.test(a) ? a : '' }

function describeError(json) {
  if (json?.error === 9) return 'Last.fm session expired (reconnect in Settings).'
  if (json?.error === 13) return 'Last.fm rejected the request signature (check the API secret).'
  return json?.message || (json?.error ? `Last.fm error ${json.error}` : 'Last.fm request failed')
}

// ---------------------------------------------------------------- queue

function ensureQueue(db) {
  db.exec('CREATE TABLE IF NOT EXISTS lastfm_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, scrobble TEXT NOT NULL, queued_at INTEGER NOT NULL)')
}

function enqueue(db, scrobble) {
  ensureQueue(db)
  db.prepare('INSERT INTO lastfm_queue (scrobble, queued_at) VALUES (?, ?)').run(JSON.stringify(scrobble), Date.now())
  const n = db.prepare('SELECT COUNT(*) AS n FROM lastfm_queue').get().n
  if (n > QUEUE_LIMIT) db.prepare('DELETE FROM lastfm_queue WHERE id IN (SELECT id FROM lastfm_queue ORDER BY id LIMIT ?)').run(n - QUEUE_LIMIT)
}

function queuedCount(db) {
  try { ensureQueue(db); return db.prepare('SELECT COUNT(*) AS n FROM lastfm_queue').get().n } catch { return 0 }
}

let flushing = null

/** Send queued scrobbles in batches of 50, oldest first; drop ones too old for Last.fm. */
function flushQueue(db) {
  if (flushing) return flushing
  flushing = (async () => {
    const start = settingsOf(db)
    if (!start.enabled || !start.scrobbling || !start.apiKey || !start.apiSecret || !start.sessionKey) return 0
    ensureQueue(db)
    let sent = 0
    for (;;) {
      // Re-check before every batch: stop if Last.fm was switched off or
      // reconnected (different session) while this was running.
      const s = settingsOf(db)
      if (!s.enabled || !s.scrobbling || s.sessionKey !== start.sessionKey || s.apiKey !== start.apiKey) break
      const rows = db.prepare('SELECT id, scrobble FROM lastfm_queue ORDER BY id LIMIT ?').all(BATCH)
      if (!rows.length) break
      const now = Date.now() / 1000
      const items = rows.map(r => { try { return JSON.parse(r.scrobble) } catch { return null } })
      const params = { sk: s.sessionKey }
      let i = 0
      items.forEach(item => {
        if (!item || now - item.timestamp > MAX_AGE_S) return
        params[`artist[${i}]`] = item.artist
        params[`track[${i}]`] = item.track
        params[`timestamp[${i}]`] = String(item.timestamp)
        if (item.album) params[`album[${i}]`] = item.album
        if (item.duration) params[`duration[${i}]`] = String(item.duration)
        i++
      })
      const done = () => db.prepare(`DELETE FROM lastfm_queue WHERE id IN (${rows.map(() => '?').join(',')})`).run(...rows.map(r => r.id))
      if (!i) { done(); continue }
      const json = await signedCall('track.scrobble', params, s)
      if (json.networkError || RETRYABLE.has(json.error)) break // still unreachable: try again later
      if (NEEDS_USER.has(json.error)) break // keep them until the credentials are fixed
      done() // sent, or refused for good: don't retry forever
      if (!json.error) sent += i
      else break
    }
    return sent
  })().finally(() => { flushing = null })
  return flushing
}

// ---------------------------------------------------------------- actions

async function updateNowPlaying(db, { artist, track, album, duration }) {
  const s = settingsOf(db)
  if (!s.enabled) return { skipped: true, reason: 'Last.fm disabled' }
  if (!s.apiKey || !s.apiSecret || !s.sessionKey) return { skipped: true, reason: 'Last.fm not configured' }
  if (!artist || !track) return { skipped: true, reason: 'No artist or title' }
  const params = { artist: primaryArtist(db, artist), track, sk: s.sessionKey }
  const al = albumOf(album)
  if (al) params.album = al
  if (duration) params.duration = String(Math.round(duration))
  const json = await signedCall('track.updateNowPlaying', params, s)
  if (json.networkError) return { error: `Couldn't reach Last.fm (${json.networkError})` }
  if (json.error) return { error: describeError(json) }
  return { ok: true }
}

async function scrobble(db, { artist, track, album, duration, timestamp }) {
  const s = settingsOf(db)
  if (!s.enabled) return { skipped: true, reason: 'Last.fm disabled' }
  if (!s.scrobbling) return { skipped: true, reason: 'Scrobbling disabled' }
  if (!s.apiKey || !s.apiSecret || !s.sessionKey) return { skipped: true, reason: 'Last.fm not configured' }
  if (!artist || !track || !timestamp) return { error: 'artist, track and timestamp required' }
  const item = { artist: primaryArtist(db, artist), track, album: albumOf(album), duration: duration ? Math.round(duration) : 0, timestamp: Math.floor(Number(timestamp)) }
  const params = { 'artist[0]': item.artist, 'track[0]': item.track, 'timestamp[0]': String(item.timestamp), sk: s.sessionKey }
  if (item.album) params['album[0]'] = item.album
  if (item.duration) params['duration[0]'] = String(item.duration)
  const json = await signedCall('track.scrobble', params, s)
  if (json.networkError || RETRYABLE.has(json.error) || NEEDS_USER.has(json.error)) {
    enqueue(db, item)
    return { queued: true, reason: json.networkError ? `Couldn't reach Last.fm (${json.networkError})` : describeError(json) }
  }
  if (json.error) return { error: describeError(json) }
  if (queuedCount(db)) flushQueue(db).catch(() => {})
  const attr = json.scrobbles?.['@attr']
  if (attr && Number(attr.accepted) === 0 && Number(attr.ignored) > 0) {
    const reason = [].concat(json.scrobbles?.scrobble || [])[0]?.ignoredMessage?.['#text']
    return { ignored: true, reason: reason ? `Last.fm ignored it: ${reason}` : 'Last.fm ignored this scrobble' }
  }
  return { ok: true }
}

module.exports = { sign, signedCall, primaryArtist, keepCommaArtists, updateNowPlaying, scrobble, flushQueue, queuedCount, settingsOf }
