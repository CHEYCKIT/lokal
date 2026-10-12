// What the TV plays from: an HTTP server on this computer, reachable from the
// network only while casting. The TV is handed one address per song (and per
// cover) and fetches it itself, seeking with range requests.
//
// Nothing else in the library is reachable: every address carries the
// session's random token and the random key of something put up for the TV
// (a queued song, its cover), and the server stops when casting does.
// Online songs (YouTube, SoundCloud, addons) are relayed: their links only
// work for this computer, so the TV gets the bytes from here.

const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'range, content-type',
  'access-control-expose-headers': 'content-range, content-length, accept-ranges',
}

/**
 * This computer's address on the TV's network: an interface in the same
 * subnet as the device, else the first private IPv4 one.
 */
function localAddressFor(deviceHost, interfaces = os.networkInterfaces()) {
  const candidates = []
  for (const list of Object.values(interfaces || {})) {
    for (const item of list || []) {
      if (item && !item.internal && (item.family === 'IPv4' || item.family === 4)) candidates.push(item)
    }
  }
  const toInt = ip => String(ip).split('.').reduce((n, part) => (n * 256) + (Number(part) & 255), 0) >>> 0
  if (/^127\./.test(String(deviceHost || ''))) return '127.0.0.1' // a device on this computer (a test receiver)
  if (deviceHost) {
    const device = toInt(deviceHost)
    for (const item of candidates) {
      const mask = toInt(item.netmask || '255.255.255.0')
      if (((toInt(item.address) & mask) >>> 0) === ((device & mask) >>> 0)) return item.address
    }
  }
  const privateRange = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
  return (candidates.find(item => privateRange.test(item.address)) || candidates[0])?.address || '127.0.0.1'
}

/** "bytes=a-b" for a file of `size` bytes: { start, end } or null (whole file), or 'bad'. */
function parseRange(header, size) {
  const found = String(header || '').match(/^bytes=(\d*)-(\d*)$/)
  if (!found) return null
  let start = found[1] === '' ? null : Number(found[1])
  let end = found[2] === '' ? null : Number(found[2])
  if (start == null) { if (end == null) return 'bad'; start = Math.max(0, size - end); end = size - 1 }
  if (end == null || end >= size) end = size - 1
  if (start > end || start >= size) return 'bad'
  return { start, end }
}

function createCastMediaServer({ log = () => {} } = {}) {
  let server = null
  let port = 0
  let token = null
  const items = new Map() // key -> { kind: 'file'|'relay'|'json', ... }

  async function serveFile(req, res, item) {
    let stat
    try { stat = fs.statSync(item.path) } catch { res.writeHead(404, CORS); res.end(); return }
    const range = parseRange(req.headers.range, stat.size)
    if (range === 'bad') { res.writeHead(416, { ...CORS, 'content-range': `bytes */${stat.size}` }); res.end(); return }
    const { start, end } = range || { start: 0, end: stat.size - 1 }
    res.writeHead(range ? 206 : 200, {
      ...CORS,
      'content-type': item.mime,
      'accept-ranges': 'bytes',
      'content-length': String(end - start + 1),
      ...(range ? { 'content-range': `bytes ${start}-${end}/${stat.size}` } : {}),
      'cache-control': 'no-store',
    })
    if (req.method === 'HEAD') { res.end(); return }
    const stream = fs.createReadStream(item.path, { start, end })
    stream.on('error', () => res.destroy())
    res.on('close', () => stream.destroy())
    stream.pipe(res)
  }

  async function serveRelay(req, res, item) {
    const upstream = new AbortController()
    res.on('close', () => { if (!res.writableEnded) upstream.abort() })
    let answer
    try {
      answer = await item.fetchRange(req.headers.range || null, upstream.signal)
    } catch (error) {
      log(`relay ${item.label}: ${error?.message || error}`)
      if (!res.headersSent) res.writeHead(502, { ...CORS, 'content-type': 'text/plain' })
      res.end(String(error?.message || error))
      return
    }
    const headers = { ...CORS, 'content-type': item.mime || answer.headers?.get?.('content-type') || 'application/octet-stream', 'cache-control': 'no-store' }
    for (const name of ['content-length', 'content-range', 'accept-ranges']) {
      const value = answer.headers?.get?.(name)
      if (value) headers[name] = value
    }
    if (!headers['accept-ranges'] && answer.status === 206) headers['accept-ranges'] = 'bytes'
    res.writeHead(answer.status, headers)
    if (req.method === 'HEAD' || !answer.body) { try { await answer.body?.cancel?.() } catch {} res.end(); return }
    const reader = answer.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done || res.destroyed) break
        // Whichever comes first, the other listener goes (they'd pile up on a long song).
        if (!res.write(value)) {
          await new Promise(resolve => {
            const done = () => { res.off('drain', done); res.off('close', done); resolve() }
            res.once('drain', done)
            res.once('close', done)
          })
        }
      }
    } catch {} finally {
      try { await reader.cancel() } catch {}
      res.end()
    }
  }

  async function handle(req, res) {
    const found = String(req.url || '').match(/^\/([0-9a-f]{32})\/([0-9a-f]{24})(?:\/[^?]*)?(?:\?.*)?$/)
    if (!found || found[1] !== token) { res.writeHead(404); res.end(); return }
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, CORS); res.end(); return }
    const item = items.get(found[2])
    if (!item) { res.writeHead(404, CORS); res.end(); return }
    if (item.kind === 'file') return serveFile(req, res, item)
    if (item.kind === 'relay') return serveRelay(req, res, item)
    if (item.kind === 'json') {
      const body = Buffer.from(JSON.stringify(item.data))
      res.writeHead(200, { ...CORS, 'content-type': 'application/json', 'content-length': String(body.length), 'cache-control': 'no-store' })
      res.end(req.method === 'HEAD' ? undefined : body)
      return
    }
    res.writeHead(404, CORS); res.end()
  }

  /** Starts listening (once per casting session) on every interface; a new token each time. */
  function start() {
    if (server) return Promise.resolve(port)
    token = crypto.randomBytes(16).toString('hex')
    server = http.createServer((req, res) => { handle(req, res).catch(error => { log(`media server: ${error?.message || error}`); try { res.destroy() } catch {} }) })
    return new Promise((resolve, reject) => {
      server.once('error', error => { server = null; reject(error) })
      server.listen(0, '0.0.0.0', () => { port = server.address().port; resolve(port) })
    })
  }

  /** Puts something up for the TV; returns its address path ("/<token>/<key>/<name>"). */
  function add(item, name = 'media') {
    const key = crypto.randomBytes(12).toString('hex')
    items.set(key, item)
    return { key, path: `/${token}/${key}/${encodeURIComponent(name)}` }
  }

  function remove(key) { items.delete(key) }

  function stop() {
    items.clear()
    if (!server) return
    try { server.closeAllConnections?.() } catch {}
    server.close()
    server = null
    token = null
  }

  return {
    start, stop, add, remove,
    /** The full address of a path for a device at `deviceHost`. */
    urlFor: (pathPart, deviceHost) => `http://${localAddressFor(deviceHost)}:${port}${pathPart}`,
    get running() { return !!server },
    get port() { return port },
    get size() { return items.size },
  }
}

module.exports = { createCastMediaServer, localAddressFor, parseRange }
