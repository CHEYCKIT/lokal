// Optional access key for the web server (API_KEY in .env), for anyone who
// exposes Lokal beyond their own network. When API_KEY is set, every /api
// route needs it; when it isn't, nothing changes.
//
// The key is accepted from:
//   - an "x-api-key" header (scripts, other clients), or
//   - the "lokal_api_key" cookie, which POST /api/auth sets after checking the
//     key. The cookie is what lets the web app's <img> and <audio> requests
//     (artwork, streams) through, since those can't carry a header. It's
//     SameSite=Lax, not Strict, so it's still sent when Last.fm redirects
//     back to /api/lastfm/callback.
//
// /api/remote keeps its own REMOTE_TOKEN check on top of this.

const crypto = require('crypto')

const COOKIE = 'lokal_api_key'
const ONE_YEAR_S = 365 * 24 * 3600

function configuredKey() {
  return String(process.env.API_KEY || '').trim()
}

function sameKey(given, expected) {
  const a = crypto.createHash('sha256').update(String(given || '')).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() !== name) continue
    try { return decodeURIComponent(part.slice(i + 1).trim()) } catch { return '' }
  }
  return ''
}

function providedKey(req) {
  return req.headers['x-api-key'] || cookieValue(req, COOKIE)
}

/** Mounted on /api, before every router. */
function requireApiKey(req, res, next) {
  const key = configuredKey()
  if (!key) return next()
  // Checks the key and hands out the cookie, so it must be reachable without one.
  if (req.method === 'POST' && req.path === '/auth') return next()
  if (sameKey(providedKey(req), key)) return next()
  res.status(401).json({ error: 'This Lokal server needs its API key.', needsApiKey: true })
}

/** POST /api/auth { key }: check the key and remember it in this browser. */
function authRoute(req, res) {
  const key = configuredKey()
  if (!key) return res.json({ ok: true, required: false })
  if (!sameKey(req.body?.key, key)) return res.status(401).json({ error: 'Wrong API key.', needsApiKey: true })
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(key)}; Path=/; Max-Age=${ONE_YEAR_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`)
  res.json({ ok: true, required: true })
}

module.exports = { requireApiKey, authRoute }
