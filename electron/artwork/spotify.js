// Spotify Canvas: the short looping clips Spotify shows behind a track. Same
// approach as BitChord, and just as unofficial:
//
//   1. Your own sp_dc cookie (pasted in Settings) is put into a private,
//      in-memory browser session, and open.spotify.com is loaded there in a
//      hidden window. The web player mints its own access token and client
//      token; we read both off the network (Chrome DevTools protocol) rather
//      than building them by hand -- hand-made tokens get refused (429).
//   2. The track is found with the Web API search (title/artist checked).
//   3. Its canvas is asked for from Spotify's internal canvas service
//      (protobuf; it only answers requests that look like the iOS app).
//
// Without a cookie, or with one Spotify doesn't accept, this simply finds
// nothing. The cookie only ever goes to *.spotify.com.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const CANVAS_UA = 'Spotify/9.0.34.593 iOS/18.4 (iPhone15,3)'
const CANVAS_URL = 'https://spclient.wg.spotify.com/canvaz-cache/v0/canvases'
const PARTITION = 'lokal-spotify-canvas' // no "persist:" -- nothing is written to disk
const TOKEN_TIMEOUT = 25000   // waiting for the page's token requests
const MINT_DEADLINE = 40000   // the whole sign-in step, whatever gets stuck

/** `promise`, or `fallback` after `ms` -- for Electron calls that can stall. */
function within(promise, ms, fallback) {
  let timer
  return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms) })]).finally(() => clearTimeout(timer))
}

class TransientError extends Error {
  constructor(message) { super(message); this.transient = true }
}

// ---------------------------------------------------------------- tokens

let tokens = null      // { accessToken, exp, clientToken, clientExp, cookie }
let minting = null     // Promise while the hidden window is working
let failed = null      // { cookie, at, message } -- don't hammer Spotify after a failure

function cookieValue(raw) {
  // Accept the bare value or a pasted "sp_dc=...;" fragment.
  const s = String(raw || '').trim()
  const m = s.match(/(?:^|;\s*)sp_dc=([^;]+)/)
  return (m ? m[1] : s).trim()
}

/**
 * Runs mintTokensInner with a hard deadline: whichever step stalls (clearing
 * storage, the page never finishing, no token request), the caller gets an
 * error naming that step instead of waiting forever.
 */
function mintTokens(cookie) {
  // Each step is logged (never the cookie or tokens) so a stall can be traced.
  let stage = 'starting'
  const state = {
    win: null,
    get stage() { return stage },
    set stage(v) { stage = v; console.log(`[spotify-canvas] ${v}`) },
  }
  console.log('[spotify-canvas] starting')
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { state.win?.destroy() } catch {}
      reject(new TransientError(`Spotify didn't answer in time (stuck ${state.stage}).`))
    }, MINT_DEADLINE)
  })
  return Promise.race([mintTokensInner(cookie, state), deadline])
    .then(t => { console.log('[spotify-canvas] signed in'); return t }, e => { console.log(`[spotify-canvas] failed: ${e.message}`); throw e })
    .finally(() => clearTimeout(timer))
}

async function mintTokensInner(cookie, state) {
  const { BrowserWindow, session, app } = require('electron')
  if (!app.isReady()) await app.whenReady()
  const part = session.fromPartition(PARTITION)
  // A clean session each time so the page mints a fresh token for this
  // cookie. clearStorageData can stall in some Electron builds: don't wait
  // on it for long -- the partition is in-memory anyway.
  state.stage = 'clearing the old session'
  await within(part.clearStorageData().catch(() => {}), 3000)
  state.stage = 'setting the cookie'
  await part.cookies.set({
    url: 'https://open.spotify.com', domain: '.spotify.com', path: '/', name: 'sp_dc', value: cookie,
    secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate: Math.floor(Date.now() / 1000) + 3600,
  })

  state.stage = 'opening open.spotify.com'
  const win = state.win = new BrowserWindow({
    show: false, width: 800, height: 600,
    webPreferences: { session: part, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, images: false },
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setUserAgent(UA)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const found = {}
  const watched = new Map() // requestId -> 'token' | 'client'
  const dbg = win.webContents.debugger
  try {
    // The DevTools protocol only answers once the window has a page: on a
    // fresh window Network.enable never returned (the check sat "opening
    // open.spotify.com" until the deadline). Give it a blank page first.
    state.stage = 'preparing the hidden window'
    await within(win.loadURL('about:blank').catch(() => {}), 5000)
    dbg.attach('1.3')
    state.stage = 'starting network monitoring'
    const enabled = await within(dbg.sendCommand('Network.enable').then(() => true, () => false), 5000, false)
    if (!enabled) throw new TransientError('Couldn\'t watch the hidden Spotify window (DevTools protocol didn\'t answer).')
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new TransientError('Spotify took too long to answer')), TOKEN_TIMEOUT)
      dbg.on('message', async (_e, method, params) => {
        try {
          if (method === 'Network.responseReceived') {
            const url = params.response?.url || ''
            if (/open\.spotify\.com\/api\/token|\/get_access_token/.test(url)) watched.set(params.requestId, 'token')
            else if (/clienttoken\.spotify\.com\/v1\/clienttoken/.test(url)) watched.set(params.requestId, 'client')
          } else if (method === 'Network.loadingFinished' && watched.has(params.requestId)) {
            const kind = watched.get(params.requestId)
            const { body, base64Encoded } = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId })
            const json = JSON.parse(base64Encoded ? Buffer.from(body, 'base64').toString() : body)
            console.log(`[spotify-canvas] got ${kind === 'token' ? `access token (anonymous: ${!!json?.isAnonymous})` : `client token (${json?.response_type || 'no type'})`}`)
            if (kind === 'token' && json?.accessToken) {
              if (json.isAnonymous) { clearTimeout(timer); reject(new Error('Spotify didn\'t accept the cookie (it may have expired). Copy a fresh sp_dc.')); return }
              found.token = json
            }
            if (kind === 'client' && json?.response_type === 'RESPONSE_GRANTED_TOKEN_RESPONSE') found.client = json.granted_token
            if (found.token && found.client) { clearTimeout(timer); resolve() }
          }
        } catch {}
      })
    })
    // Not awaited: the web player may never report "finished loading" (it
    // keeps connections open), and the token requests come in regardless.
    state.stage = 'waiting for the web player to sign in'
    win.loadURL('https://open.spotify.com/').catch(() => {})
    try {
      await done
    } catch (e) {
      // The access token is what matters; the client token helps but isn't
      // always requested by the page right away.
      if (!found.token) throw e
    }
  } finally {
    try { dbg.detach() } catch {}
    try { win.destroy() } catch {}
    within(part.clearStorageData().catch(() => {}), 3000)
  }

  const t = found.token
  return {
    cookie,
    accessToken: t.accessToken,
    exp: Number(t.accessTokenExpirationTimestampMs) || Date.now() + 30 * 60 * 1000,
    clientToken: found.client?.token || null,
    clientExp: found.client ? Date.now() + (Number(found.client.expires_after_seconds) || 3600) * 1000 : 0,
  }
}

async function getTokens(rawCookie, { force = false } = {}) {
  const cookie = cookieValue(rawCookie)
  if (!cookie) return null
  if (!force && tokens?.cookie === cookie && tokens.exp - 30000 > Date.now()) return tokens
  if (!force && failed?.cookie === cookie && Date.now() - failed.at < 10 * 60 * 1000) throw new TransientError(failed.message)
  if (!minting) {
    minting = mintTokens(cookie)
      .then(t => { tokens = t; failed = null; return t })
      .catch(e => { tokens = null; failed = { cookie, at: Date.now(), message: e.message }; throw e })
      .finally(() => { minting = null })
  }
  const t = await minting
  if (t.cookie !== cookie) return getTokens(rawCookie, { force })
  return t
}

// ---------------------------------------------------------------- protobuf

function varint(n) {
  const out = []
  while (n > 127) { out.push((n & 127) | 128); n >>>= 7 }
  out.push(n)
  return Buffer.from(out)
}
const lenField = (num, buf) => Buffer.concat([varint((num << 3) | 2), varint(buf.length), buf])

function readVarint(buf, pos) {
  let result = 0, shift = 0, b
  do {
    if (pos >= buf.length) throw new Error('truncated')
    b = buf[pos++]
    result += (b & 127) * 2 ** shift
    shift += 7
  } while (b & 128)
  return [result, pos]
}

/** Top-level fields of a protobuf message: [{ num, value }] (length-delimited values as Buffers). */
function fields(buf) {
  const out = []
  let pos = 0
  while (pos < buf.length) {
    let key
    ;[key, pos] = readVarint(buf, pos)
    const num = Math.floor(key / 8), wire = key & 7
    if (wire === 0) { let v; [v, pos] = readVarint(buf, pos); out.push({ num, value: v }) }
    else if (wire === 2) { let len; [len, pos] = readVarint(buf, pos); out.push({ num, value: buf.subarray(pos, pos + len) }); pos += len }
    else if (wire === 1) pos += 8
    else if (wire === 5) pos += 4
    else throw new Error('unsupported wire type')
  }
  return out
}

/** Canvas URLs in a canvaz-cache response, preferring the one for `uri`. */
function parseCanvases(buf, uri) {
  const found = []
  try {
    for (const f of fields(buf)) {
      if (f.num !== 1 || !Buffer.isBuffer(f.value)) continue
      const c = {}
      for (const g of fields(f.value)) {
        if (g.num === 2 && Buffer.isBuffer(g.value)) c.url = g.value.toString()
        if (g.num === 5 && Buffer.isBuffer(g.value)) c.uri = g.value.toString()
      }
      if (c.url) found.push(c)
    }
  } catch {}
  if (!found.length) {
    const m = buf.toString('latin1').match(/https:\/\/[^"'\s\x00-\x1F]+\.cnvs\.mp4/)
    if (m) found.push({ url: m[0] })
  }
  const pick = found.find(c => c.uri === uri) || found[0]
  return pick && /^https:\/\//.test(pick.url) && /\.mp4(?:[?#]|$)/i.test(pick.url) ? pick.url : null
}

// ---------------------------------------------------------------- lookup

async function request(url, opts, timeoutMs = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(url, { ...opts, signal: controller.signal }) } finally { clearTimeout(timer) }
}

function authFailed(status) {
  if (status === 401) tokens = null
  return status === 401 || status === 429 || status >= 500
}

async function findTrackUri(t, { title, artist, album }, { norm, cleanTitle, artistsMatch, splitFirstArtist }) {
  const wantTitle = norm(cleanTitle(title))
  const q = `track:${cleanTitle(title)} artist:${splitFirstArtist(artist)}`
  const res = await request(`https://api.spotify.com/v1/search?type=track&limit=10&q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${t.accessToken}`, Accept: 'application/json', 'User-Agent': UA },
  })
  if (!res.ok) { if (authFailed(res.status)) throw new TransientError(`Spotify search HTTP ${res.status}`); return null }
  const items = (await res.json())?.tracks?.items || []
  // Spotify appends " - Remastered 2011" etc. to titles; compare without it.
  const bare = s => norm(String(s || '').replace(/\s+-\s+.*$/, ''))
  const candidates = items.filter(it =>
    (norm(it.name) === wantTitle || bare(it.name) === wantTitle)
    && artistsMatch(artist, (it.artists || []).map(a => a.name)))
  const wantAlbum = norm(album)
  const exact = wantAlbum ? candidates.find(it => norm(it.album?.name) === wantAlbum) : null
  // Canvases belong to the track, and the single and the album cut usually
  // share one -- so a title+artist match on another release still counts.
  return (exact || candidates[0])?.uri || null
}

async function canvasFor(t, uri) {
  const headers = {
    'Content-Type': 'application/protobuf', Accept: 'application/protobuf', 'Accept-Language': 'en',
    Authorization: `Bearer ${t.accessToken}`, 'User-Agent': CANVAS_UA,
  }
  if (t.clientToken && t.clientExp > Date.now()) headers['client-token'] = t.clientToken
  const res = await request(CANVAS_URL, { method: 'POST', headers, body: lenField(1, lenField(1, Buffer.from(uri))) })
  if (!res.ok) { if (authFailed(res.status)) throw new TransientError(`Spotify canvas HTTP ${res.status}`); return null }
  return parseCanvases(Buffer.from(await res.arrayBuffer()), uri)
}

// One lookup at a time: they share the tokens, and it keeps us polite.
let queue = Promise.resolve()

/**
 * Provider for motion.js. `helpers` are motion.js' matching functions.
 * Throws a TransientError (not cached as "no canvas") when Spotify itself failed.
 */
function fromSpotify(track, settings, helpers) {
  const job = queue.then(async () => {
    const t = await getTokens(settings.spotify_sp_dc)
    if (!t) return null
    const uri = await findTrackUri(t, track, helpers)
    if (!uri) return null
    const url = await canvasFor(t, uri)
    return url ? { url, kind: 'mp4', source: 'spotify', tall: true } : null
  })
  queue = job.catch(() => {})
  return job
}

/** Settings' "Save & Test": can this cookie get a signed-in token? */
async function checkSpotify(rawCookie) {
  if (!cookieValue(rawCookie)) return { error: 'Paste your sp_dc cookie first.' }
  try {
    const t = await getTokens(rawCookie, { force: true })
    return t ? { ok: true } : { error: 'No token' }
  } catch (e) {
    return { error: e.message || 'Could not reach Spotify' }
  }
}

module.exports = { fromSpotify, checkSpotify, parseCanvases, cookieValue, TransientError }
