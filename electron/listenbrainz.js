// ListenBrainz (listenbrainz.org): "now playing" and listens, sent with the
// user's own token (listenbrainz.org/settings). Shared by the desktop app (IPC)
// and the web server, so neither needs Electron.
//
// A listen that can't be sent right now (offline, ListenBrainz down or rate
// limiting) is kept in a small queue and sent later as an "import" batch, so
// nothing is lost. A rejected token is not queued: that needs the user.
//
// API: https://listenbrainz.readthedocs.io/en/latest/users/api/core.html

const API = 'https://api.listenbrainz.org/1'
const QUEUE_LIMIT = 5000
const BATCH = 100
const QUEUE_RETRY_INTERVAL_MS = 60 * 1000
const FLUSH_SOON_MS = 30 * 1000

let clientVersion = ''
try { clientVersion = require('../package.json').version || '' } catch {}

/** ListenBrainz token, username and on/off switch from the settings table. */
function settingsOf(db) {
  const get = (key) => {
    try { return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '' } catch { return '' }
  }
  return {
    token: get('listenbrainz_token').trim(),
    username: get('listenbrainz_username'),
    enabled: get('listenbrainz_enabled') === '1',
  }
}

/** Write one setting. */
function setSetting(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value ?? ''))
}

/** Call the ListenBrainz API; resolves to { status, ok, json } (status 0 when unreachable). */
async function call(path, { token, method = 'GET', body, timeoutMs = 10000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const json = await res.json().catch(() => ({}))
    return { status: res.status, ok: res.ok, json }
  } catch (e) {
    return { status: 0, ok: false, json: {}, error: e.name === 'AbortError' ? 'timed out' : e.message }
  } finally {
    clearTimeout(timer)
  }
}

/** Is this token valid, and whose is it? */
async function validateToken(token) {
  const t = String(token || '').trim()
  if (!t) return { valid: false, error: 'Paste your ListenBrainz user token first.' }
  const r = await call('/validate-token', { token: t })
  if (r.status === 0) return { valid: false, error: `Couldn't reach ListenBrainz (${r.error}).` }
  if (r.json?.valid) return { valid: true, username: r.json.user_name || '' }
  return { valid: false, error: 'ListenBrainz says this token is not valid. Copy it again from listenbrainz.org/settings.' }
}

const NO_ALBUM = /^\s*(?:unknown album|unknown)?\s*$/i

/** The listen as ListenBrainz wants it. `track`: { title, artist, album, duration (s), track_num } */
function listenOf(track, listenedAt) {
  const info = { media_player: 'Lokal', submission_client: 'Lokal' }
  if (clientVersion) info.submission_client_version = clientVersion
  const duration = Math.round(Number(track?.duration) || 0)
  if (duration > 0) info.duration_ms = duration * 1000
  const trackNumber = Number(track?.track_num)
  if (trackNumber > 0) info.tracknumber = trackNumber
  const metadata = {
    artist_name: String(track.artist || '').trim(),
    track_name: String(track.title || '').trim(),
    additional_info: info,
  }
  const album = String(track.album || '').trim()
  if (album && !NO_ALBUM.test(album)) metadata.release_name = album
  const listen = { track_metadata: metadata }
  if (listenedAt) listen.listened_at = Math.floor(Number(listenedAt))
  return listen
}

// ---------------------------------------------------------------- queue

// Each queued listen belongs to the ListenBrainz account (validated username)
// that was connected when it was played, and is only ever sent with that
// account's token: connecting another account never submits them as its own.

/** Create the offline listen queue table if needed (with its account column). */
function ensureQueue(db) {
  db.exec('CREATE TABLE IF NOT EXISTS listenbrainz_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, listen TEXT NOT NULL, queued_at INTEGER NOT NULL, account TEXT NOT NULL DEFAULT \'\')')
  const columns = db.prepare('PRAGMA table_info(listenbrainz_queue)').all().map(c => c.name)
  if (!columns.includes('account')) {
    // Queues from before accounts were tracked: file their listens under the
    // account connected now (the best guess; they were most likely its own).
    db.exec("ALTER TABLE listenbrainz_queue ADD COLUMN account TEXT NOT NULL DEFAULT ''")
    db.prepare('UPDATE listenbrainz_queue SET account = ?').run(accountOf(settingsOf(db)))
  }
}

/** The account queued listens are filed under: the validated username. */
function accountOf(settings) {
  return String(settings?.username || '').trim().toLowerCase()
}

/** Queue a listen for later (for `account`), keeping the queue bounded. */
function enqueue(db, listen, account) {
  ensureQueue(db)
  db.prepare('INSERT INTO listenbrainz_queue (listen, queued_at, account) VALUES (?, ?, ?)').run(JSON.stringify(listen), Date.now(), account)
  // Keep it bounded: drop the oldest if someone is offline for a very long time.
  const count = db.prepare('SELECT COUNT(*) AS n FROM listenbrainz_queue').get().n
  if (count > QUEUE_LIMIT) db.prepare('DELETE FROM listenbrainz_queue WHERE id IN (SELECT id FROM listenbrainz_queue ORDER BY id LIMIT ?)').run(count - QUEUE_LIMIT)
}

/** How many listens are waiting to be sent for `account`. */
function queuedCount(db, account) {
  try { ensureQueue(db); return db.prepare('SELECT COUNT(*) AS n FROM listenbrainz_queue WHERE account = ?').get(account).n } catch { return 0 }
}

let flushing = null
let queueRetryTimer = null
let queueRetryDb = null
let flushSoonTimer = null

/** Flush the active account's queue now, if there is anything to send. */
function flushActive(db) {
  const s = settingsOf(db)
  if (s.enabled && s.token && queuedCount(db, accountOf(s))) return flushQueue(db, s.token).catch(() => 0)
  return Promise.resolve(0)
}

/** Try the queue again shortly (after a listen was queued), once. */
function scheduleFlush(db) {
  if (flushSoonTimer) return
  flushSoonTimer = setTimeout(() => {
    flushSoonTimer = null
    try { flushActive(db) } catch {}
  }, FLUSH_SOON_MS)
  flushSoonTimer.unref?.()
}

/** Keep retrying queued listens while the app/server is running. */
function startQueueRetry(db) {
  if (db) queueRetryDb = db
  if (queueRetryTimer || !queueRetryDb) return

  queueRetryTimer = setInterval(() => {
    try { flushActive(queueRetryDb) } catch {}
  }, QUEUE_RETRY_INTERVAL_MS)
  queueRetryTimer.unref?.()
}

/**
 * Send the connected account's queued listens, oldest first, in batches.
 * Only listens queued for that account are sent. Stops at the first failure.
 */
function flushQueue(db, token) {
  if (flushing) return flushing
  flushing = (async () => {
    ensureQueue(db)
    const account = accountOf(settingsOf(db))
    let sent = 0
    for (;;) {
      // Re-check before every batch: stop if ListenBrainz was switched off,
      // disconnected, or connected with another token / account meanwhile.
      const s = settingsOf(db)
      if (!s.enabled || !s.token || s.token !== token || accountOf(s) !== account) break
      const rows = db.prepare('SELECT id, listen FROM listenbrainz_queue WHERE account = ? ORDER BY id LIMIT ?').all(account, BATCH)
      if (!rows.length) break
      const remove = (ids) => { if (ids.length) db.prepare(`DELETE FROM listenbrainz_queue WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids) }
      const parsed = rows.map(r => { try { return { id: r.id, listen: JSON.parse(r.listen) } } catch { return { id: r.id, listen: null } } })
      remove(parsed.filter(p => !p.listen).map(p => p.id)) // unreadable rows can never be sent
      const good = parsed.filter(p => p.listen)
      if (!good.length) continue
      const r = await call('/submit-listens', { token, method: 'POST', body: { listen_type: 'import', payload: good.map(p => p.listen) }, timeoutMs: 20000 })
      if (r.ok) {
        remove(good.map(p => p.id))
        sent += good.length
        continue
      }
      if (r.status !== 400) break // offline, rate limited, server error: keep them for later
      // One bad listen makes ListenBrainz refuse the whole batch: send them one
      // by one, dropping only the ones it refuses on their own.
      let stopped = false
      for (const p of good) {
        // Same check as before each batch: ListenBrainz may have been switched
        // off or reconnected with another token while these were being sent.
        const now = settingsOf(db)
        if (!now.enabled || !now.token || now.token !== token || accountOf(now) !== account) { stopped = true; break }
        const one = await call('/submit-listens', { token, method: 'POST', body: { listen_type: 'import', payload: [p.listen] } })
        if (one.ok) { remove([p.id]); sent++; continue }
        if (one.status === 400) { remove([p.id]); continue } // never accepted as it is
        stopped = true // any other failure: keep this one and the rest for later
        break
      }
      if (stopped) break
    }
    return sent
  })().finally(() => { flushing = null })
  return flushing
}

// ---------------------------------------------------------------- actions

/** Check a token and, if valid, save it and switch ListenBrainz on. */
async function connect(db, token) {
  const result = await validateToken(token)
  if (!result.valid) return { error: result.error }
  // Another account than before: its listens can't be sent any more (they
  // are not this account's), so drop them rather than keep them forever.
  const account = accountOf({ username: result.username })
  try { ensureQueue(db); db.prepare('DELETE FROM listenbrainz_queue WHERE account <> ?').run(account) } catch {}
  setSetting(db, 'listenbrainz_token', String(token).trim())
  setSetting(db, 'listenbrainz_username', result.username)
  setSetting(db, 'listenbrainz_enabled', '1')
  startQueueRetry(db)
  flushActive(db)
  return { ok: true, username: result.username }
}

/** Forget the token and drop any queued listens. */
function disconnect(db) {
  setSetting(db, 'listenbrainz_token', '')
  setSetting(db, 'listenbrainz_username', '')
  setSetting(db, 'listenbrainz_enabled', '0')
  try { ensureQueue(db); db.prepare('DELETE FROM listenbrainz_queue').run() } catch {}
  return { ok: true }
}

/** Connection state for Settings: connected, username, on/off, queued count. */
function status(db) {
  startQueueRetry(db)
  const s = settingsOf(db)
  return { connected: !!s.token, username: s.username, enabled: s.enabled, queued: queuedCount(db, accountOf(s)) }
}

/** Send a "playing now" listen. */
async function nowPlaying(db, track) {
  const s = settingsOf(db)
  if (!s.enabled || !s.token) return { skipped: true, reason: 'ListenBrainz is off' }
  if (!track?.artist || !track?.title) return { skipped: true, reason: 'No artist or title' }
  const r = await call('/submit-listens', { token: s.token, method: 'POST', body: { listen_type: 'playing_now', payload: [listenOf(track)] } })
  if (r.ok) return { ok: true }
  if (r.status === 401) return { error: 'ListenBrainz rejected the token (reconnect in Settings).' }
  return { error: r.error || r.json?.error || `ListenBrainz answered ${r.status}` }
}

/** Submit a finished listen; queued if ListenBrainz can't take it right now. */
async function submitListen(db, track, listenedAt) {
  startQueueRetry(db)
  const s = settingsOf(db)
  if (!s.enabled || !s.token) return { skipped: true, reason: 'ListenBrainz is off' }
  if (!track?.artist || !track?.title) return { skipped: true, reason: 'No artist or title' }
  const listen = listenOf(track, listenedAt || Date.now() / 1000)
  const r = await call('/submit-listens', { token: s.token, method: 'POST', body: { listen_type: 'single', payload: [listen] } })
  if (r.ok) {
    // Online again: send anything that was waiting (this account's only).
    flushActive(db)
    return { ok: true }
  }
  // Permanent: sending it again won't help (the player must not retry it).
  if (r.status === 401 || r.status === 403) return { error: 'ListenBrainz rejected the token (reconnect in Settings).', permanent: true }
  if (r.status === 400) return { error: r.json?.error || 'ListenBrainz refused this listen.', permanent: true }
  // Offline, timed out, rate limited or a server error: keep it for later,
  // for this account, and try the queue again shortly.
  enqueue(db, listen, accountOf(s))
  scheduleFlush(db)
  return { queued: true, reason: r.error || `ListenBrainz answered ${r.status}` }
}

module.exports = { connect, disconnect, status, nowPlaying, submitListen, flushQueue, startQueueRetry, validateToken, listenOf, settingsOf }
