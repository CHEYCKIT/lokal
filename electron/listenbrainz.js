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

let clientVersion = ''
try { clientVersion = require('../package.json').version || '' } catch {}

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

function setSetting(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value ?? ''))
}

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

function ensureQueue(db) {
  db.exec('CREATE TABLE IF NOT EXISTS listenbrainz_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, listen TEXT NOT NULL, queued_at INTEGER NOT NULL)')
}

function enqueue(db, listen) {
  ensureQueue(db)
  db.prepare('INSERT INTO listenbrainz_queue (listen, queued_at) VALUES (?, ?)').run(JSON.stringify(listen), Date.now())
  // Keep it bounded: drop the oldest if someone is offline for a very long time.
  const count = db.prepare('SELECT COUNT(*) AS n FROM listenbrainz_queue').get().n
  if (count > QUEUE_LIMIT) db.prepare('DELETE FROM listenbrainz_queue WHERE id IN (SELECT id FROM listenbrainz_queue ORDER BY id LIMIT ?)').run(count - QUEUE_LIMIT)
}

function queuedCount(db) {
  try { ensureQueue(db); return db.prepare('SELECT COUNT(*) AS n FROM listenbrainz_queue').get().n } catch { return 0 }
}

let flushing = null

/** Send queued listens, oldest first, in batches. Stops at the first failure. */
function flushQueue(db, token) {
  if (flushing) return flushing
  flushing = (async () => {
    ensureQueue(db)
    let sent = 0
    for (;;) {
      // Re-check before every batch: stop if ListenBrainz was switched off,
      // disconnected, or connected with another token while this was running.
      const s = settingsOf(db)
      if (!s.enabled || !s.token || s.token !== token) break
      const rows = db.prepare('SELECT id, listen FROM listenbrainz_queue ORDER BY id LIMIT ?').all(BATCH)
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

async function connect(db, token) {
  const result = await validateToken(token)
  if (!result.valid) return { error: result.error }
  setSetting(db, 'listenbrainz_token', String(token).trim())
  setSetting(db, 'listenbrainz_username', result.username)
  setSetting(db, 'listenbrainz_enabled', '1')
  return { ok: true, username: result.username }
}

function disconnect(db) {
  setSetting(db, 'listenbrainz_token', '')
  setSetting(db, 'listenbrainz_username', '')
  setSetting(db, 'listenbrainz_enabled', '0')
  try { ensureQueue(db); db.prepare('DELETE FROM listenbrainz_queue').run() } catch {}
  return { ok: true }
}

function status(db) {
  const s = settingsOf(db)
  return { connected: !!s.token, username: s.username, enabled: s.enabled, queued: queuedCount(db) }
}

async function nowPlaying(db, track) {
  const s = settingsOf(db)
  if (!s.enabled || !s.token) return { skipped: true, reason: 'ListenBrainz is off' }
  if (!track?.artist || !track?.title) return { skipped: true, reason: 'No artist or title' }
  const r = await call('/submit-listens', { token: s.token, method: 'POST', body: { listen_type: 'playing_now', payload: [listenOf(track)] } })
  if (r.ok) return { ok: true }
  if (r.status === 401) return { error: 'ListenBrainz rejected the token (reconnect in Settings).' }
  return { error: r.error || r.json?.error || `ListenBrainz answered ${r.status}` }
}

async function submitListen(db, track, listenedAt) {
  const s = settingsOf(db)
  if (!s.enabled || !s.token) return { skipped: true, reason: 'ListenBrainz is off' }
  if (!track?.artist || !track?.title) return { skipped: true, reason: 'No artist or title' }
  const listen = listenOf(track, listenedAt || Date.now() / 1000)
  const r = await call('/submit-listens', { token: s.token, method: 'POST', body: { listen_type: 'single', payload: [listen] } })
  if (r.ok) {
    // Online again: send anything that was waiting.
    if (queuedCount(db)) flushQueue(db, s.token).catch(() => {})
    return { ok: true }
  }
  if (r.status === 401) return { error: 'ListenBrainz rejected the token (reconnect in Settings).' }
  if (r.status === 400) return { error: r.json?.error || 'ListenBrainz refused this listen.' }
  // Offline, timed out, rate limited or a server error: keep it for later.
  enqueue(db, listen)
  return { queued: true, reason: r.error || `ListenBrainz answered ${r.status}` }
}

module.exports = { connect, disconnect, status, nowPlaying, submitListen, flushQueue, validateToken, listenOf, settingsOf }
