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
// Two more rules while API_KEY is set:
//   - Plain HTTP only works from this machine or the local network. From
//     anywhere else the key would travel in clear text, so it's refused: put
//     Lokal behind HTTPS (a reverse proxy or tunnel with TLS) to expose it.
//   - A write (POST, PUT, PATCH, DELETE) authorised only by the cookie must
//     come from Lokal's own pages (same origin), so another site can't make
//     the browser send one. The x-api-key header is unaffected.
//
// /api/remote keeps its own REMOTE_TOKEN check on top of this.

const crypto = require('crypto')
const net = require('net')

const COOKIE = 'lokal_api_key'
const ONE_YEAR_S = 365 * 24 * 3600

/** The API_KEY from the environment, or '' when none is set. */
function configuredKey() {
  return String(process.env.API_KEY || '').trim()
}

/** Constant-time comparison of a provided key with the configured one. */
function sameKey(given, expected) {
  const a = crypto.createHash('sha256').update(String(given || '')).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

/** The value of one cookie from the request, or ''. */
function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() !== name) continue
    try { return decodeURIComponent(part.slice(i + 1).trim()) } catch { return '' }
  }
  return ''
}

// ------------------------------------------------------------ transport

/** Loopback, private (10/8, 172.16/12, 192.168/16), link-local, or IPv6 ULA. */
function isLocalAddress(address) {
  let ip = String(address || '').trim().replace(/^\[|\]$/g, '')
  if (ip.startsWith('::ffff:')) ip = ip.slice(7)
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase()
    return lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower)
  }
  return false
}

/** Did this request come from this machine or the local network? */
function isLocalRequest(req) {
  if (!isLocalAddress(req.socket?.remoteAddress)) return false
  // Behind a proxy or tunnel on this machine, every request looks local:
  // go by the client address the proxy reports instead. That's the last
  // entry: the proxy appends the address it saw, while everything before it
  // came from the client and could be made up (e.g. "127.0.0.1, <real ip>").
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean).pop()
  return !forwarded || isLocalAddress(forwarded)
}

/**
 * HTTPS here, or at a proxy/tunnel on this machine or network that says so.
 * X-Forwarded-Proto is only believed from such a proxy: a client connecting
 * directly could send it itself.
 */
function isHttps(req) {
  if (req.secure) return true
  if (!isLocalAddress(req.socket?.remoteAddress)) return false
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https'
}

/** The key may only be used over HTTPS, or over HTTP from the local network. */
function transportAllowed(req) {
  return isHttps(req) || isLocalRequest(req)
}

/** Answer 403: the key isn't accepted over plain HTTP from outside. */
function refuseInsecure(res) {
  res.status(403).json({ error: 'This Lokal server only accepts its API key over HTTPS from outside the local network.' })
}

// ------------------------------------------------------------ same origin

/** Is Origin (or, failing that, Referer) this server itself? */
function isSameOrigin(req) {
  const source = req.headers.origin || req.headers.referer
  if (!source || source === 'null') return false
  let host
  try { host = new URL(source).host } catch { return false }
  const own = [req.headers['x-forwarded-host'], req.headers.host]
    .flatMap(h => String(h || '').split(','))
    .map(h => h.trim().toLowerCase())
    .filter(Boolean)
  return own.includes(host.toLowerCase())
}

// ------------------------------------------------------------ middleware

/** Mounted on /api, before every router. */
function requireApiKey(req, res, next) {
  const key = configuredKey()
  if (!key) return next()
  // Checks the key and hands out the cookie, so it must be reachable without
  // one (it applies the same transport rule itself).
  if (req.method === 'POST' && req.path === '/auth') return next()
  const header = req.headers['x-api-key']
  const cookie = cookieValue(req, COOKIE)
  if (!header && !cookie) return res.status(401).json({ error: 'This Lokal server needs its API key.', needsApiKey: true })
  if (!transportAllowed(req)) return refuseInsecure(res)
  if (header) {
    if (sameKey(header, key)) return next()
  } else if (sameKey(cookie, key)) {
    if (isSameOrigin(req)) return next()
    return res.status(403).json({ error: 'Cross-origin request refused.' })
  }
  res.status(401).json({ error: 'This Lokal server needs its API key.', needsApiKey: true })
}

/** POST /api/auth { key }: check the key and remember it in this browser. */
function authRoute(req, res) {
  const key = configuredKey()
  if (!key) return res.json({ ok: true, required: false })
  if (!transportAllowed(req)) return refuseInsecure(res)
  if (!sameKey(req.body?.key, key)) return res.status(401).json({ error: 'Wrong API key.', needsApiKey: true })
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(key)}; Path=/; Max-Age=${ONE_YEAR_S}; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`)
  res.json({ ok: true, required: true })
}

module.exports = { requireApiKey, authRoute, isLocalAddress }
