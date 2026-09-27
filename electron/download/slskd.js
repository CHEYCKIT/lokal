// Soulseek, through slskd (https://github.com/slskd/slskd): a maintained
// Soulseek client that runs as a small service with a REST API. Lokal doesn't
// speak the Soulseek protocol itself; it asks slskd to search and download,
// follows the transfer, then picks the finished file up from slskd's downloads
// folder and treats it like any other download (lyrics, cover, library).
//
// Settings: soulseek_url (default http://localhost:5030), soulseek_api_key
// (an API key from slskd.yml, web.authentication.api_keys), and optionally
// soulseek_downloads_dir when slskd sees its folder under another path than
// this machine does (Docker, a NAS share).

const fs = require('fs')
const path = require('path')

const AUDIO_EXT = new Set(['flac', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'aif', 'aiff', 'alac', 'ape', 'wv', 'dsf'])
const LOSSLESS_EXT = new Set(['flac', 'wav', 'aif', 'aiff', 'alac', 'ape', 'wv', 'dsf'])

function config(settings = {}) {
  const url = String(settings.soulseek_url || 'http://localhost:5030').trim().replace(/\/+$/, '')
  return {
    url,
    apiKey: String(settings.soulseek_api_key || '').trim(),
    downloadsDir: String(settings.soulseek_downloads_dir || '').trim() || null,
  }
}

class SlskdError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

async function request(settings, method, route, body, { timeoutMs = 15000 } = {}) {
  const { url, apiKey } = config(settings)
  if (!apiKey) throw new SlskdError('Add your slskd API key in Settings → Soulseek.', 401)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(`${url}/api/v0${route}`, {
      method,
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    throw new SlskdError(e.name === 'AbortError' ? `slskd at ${url} didn't answer.` : `Can't reach slskd at ${url}. Is it running?`, 0)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text().catch(() => '')
  if (res.status === 401 || res.status === 403) throw new SlskdError('slskd rejected the API key. Check it in Settings → Soulseek.', res.status)
  if (!res.ok) throw new SlskdError(text ? text.replace(/^"|"$/g, '').slice(0, 200) : `slskd answered ${res.status}`, res.status)
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}

/** Is slskd there, logged in to Soulseek, and where does it put downloads? */
async function status(settings) {
  const state = await request(settings, 'GET', '/application', undefined, { timeoutMs: 6000 })
  let downloadsDir = config(settings).downloadsDir
  if (!downloadsDir) {
    try {
      const options = await request(settings, 'GET', '/options', undefined, { timeoutMs: 6000 })
      downloadsDir = options?.directories?.downloads || null
    } catch {}
  }
  let server = state?.server || {}
  // Older slskd versions keep the connection state only under /server.
  if (server.isLoggedIn === undefined && !server.state) {
    try { server = (await request(settings, 'GET', '/server', undefined, { timeoutMs: 6000 })) || {} } catch {}
  }
  return {
    ok: true,
    serverState: server.state || null,
    loggedIn: !!(server.isLoggedIn ?? /LoggedIn/.test(String(server.state || ''))),
    username: state?.user?.username || null,
    version: state?.version?.current || state?.version?.full || null,
    downloadsDir,
    downloadsDirReachable: !!(downloadsDir && fs.existsSync(downloadsDir)),
  }
}

// ---------------------------------------------------------------- search

function extOf(filename) {
  const m = String(filename || '').match(/\.([a-z0-9]{2,5})$/i)
  return m ? m[1].toLowerCase() : ''
}

function splitRemote(filename) {
  const parts = String(filename || '').split(/[\\/]/).filter(Boolean)
  return { name: parts[parts.length - 1] || filename, folder: parts.length > 1 ? parts[parts.length - 2] : '', directory: parts.slice(0, -1).join('\\') }
}

function qualityLabel(file) {
  const ext = extOf(file.filename)
  if (LOSSLESS_EXT.has(ext)) {
    const depth = file.bitDepth ? `${file.bitDepth}-bit` : ''
    const rate = file.sampleRate ? `${+(file.sampleRate / 1000).toFixed(1)} kHz` : ''
    return [ext.toUpperCase(), [depth, rate].filter(Boolean).join(' / ')].filter(Boolean).join(' ')
  }
  return `${ext.toUpperCase()}${file.bitRate ? ` ${file.bitRate}${file.isVariableBitRate ? ' VBR' : ''}` : ''}`
}

/**
 * How good a pick this file is: lossless beats lossy, then bitrate; a user
 * with a free slot and a fast connection beats one with a long queue.
 */
function score(file, response) {
  const ext = extOf(file.filename)
  let s = LOSSLESS_EXT.has(ext) ? 1000 + (file.bitDepth === 24 ? 20 : 0) : Math.min(320, file.bitRate || 128) * 2
  if (response.hasFreeUploadSlot) s += 150
  s += Math.min(100, (response.uploadSpeed || 0) / 20000)
  s -= Math.min(200, (response.queueLength || 0) * 5)
  return Math.round(s)
}

function flatten(responses = []) {
  const out = []
  for (const response of responses) {
    for (const file of response.files || []) {
      const ext = extOf(file.filename)
      if (!AUDIO_EXT.has(ext)) continue
      const { name, folder, directory } = splitRemote(file.filename)
      out.push({
        key: `${response.username}\u0000${file.filename}`,
        username: response.username,
        filename: file.filename,
        name,
        folder,
        directory,
        size: file.size,
        extension: ext,
        lossless: LOSSLESS_EXT.has(ext),
        bitRate: file.bitRate || null,
        bitDepth: file.bitDepth || null,
        sampleRate: file.sampleRate || null,
        length: file.length || null,
        quality: qualityLabel(file),
        freeSlot: !!response.hasFreeUploadSlot,
        uploadSpeed: response.uploadSpeed || 0,
        queueLength: response.queueLength || 0,
        score: score(file, response),
      })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

async function startSearch(settings, text) {
  const q = String(text || '').trim()
  if (!q) throw new SlskdError('Type something to search for.', 400)
  const search = await request(settings, 'POST', '/searches', {
    searchText: q,
    searchTimeout: 15,
    responseLimit: 200,
    fileLimit: 5000,
    filterResponses: true,
  })
  return { id: search?.id, text: q }
}

async function searchResults(settings, id) {
  const search = await request(settings, 'GET', `/searches/${encodeURIComponent(id)}?includeResponses=true`)
  const complete = !!(search?.isComplete ?? /Completed/.test(String(search?.state || '')))
  const results = flatten(search?.responses || [])
  if (complete) request(settings, 'DELETE', `/searches/${encodeURIComponent(id)}`).catch(() => {})
  return { id, complete, state: search?.state || null, responseCount: search?.responseCount ?? null, results: results.slice(0, 400) }
}

function stopSearch(settings, id) {
  return request(settings, 'DELETE', `/searches/${encodeURIComponent(id)}`).catch(() => null)
}

// ---------------------------------------------------------------- transfers

async function enqueue(settings, username, filename, size) {
  try {
    return await request(settings, 'POST', `/transfers/downloads/${encodeURIComponent(username)}`, [{ filename, size: Number(size) || 0 }], { timeoutMs: 30000 })
  } catch (e) {
    // Already queued or downloading in slskd (a resumed job): follow that one.
    if (e.status === 409 || /already/i.test(e.message)) return null
    throw e
  }
}

/** The newest transfer slskd has for this user and file, or null. */
async function findTransfer(settings, username, filename) {
  const user = await request(settings, 'GET', `/transfers/downloads/${encodeURIComponent(username)}`).catch(e => {
    if (e.status === 404) return null
    throw e
  })
  const files = (user?.directories || []).flatMap(d => d.files || [])
  return files
    .filter(f => f.filename === filename)
    .sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')))[0] || null
}

function cancelTransfer(settings, username, id) {
  return request(settings, 'DELETE', `/transfers/downloads/${encodeURIComponent(username)}/${encodeURIComponent(id)}?remove=true`).catch(() => null)
}

/** "Completed, Succeeded" -> { done, ok, queued, active, label } */
function describeState(state) {
  const s = String(state || '')
  const done = /Completed/.test(s)
  return {
    done,
    ok: done && /Succeeded/.test(s),
    queued: /Queued|Requested|Initializing/.test(s) && !done,
    active: /InProgress/.test(s),
    remote: /Remotely/.test(s),
    reason: done && !/Succeeded/.test(s) ? (s.match(/Errored|Rejected|TimedOut|Cancelled|Aborted/) || ['Failed'])[0] : null,
  }
}

/**
 * Where slskd put the finished file. It keeps the remote folder name by
 * default, but that's configurable and a clash gets a suffix, so: look for
 * the name first, then any file of the same size and extension written since
 * the download started.
 */
function locateDownload(downloadsDir, filename, size, since = 0) {
  if (!downloadsDir || !fs.existsSync(downloadsDir)) return null
  const { name, folder } = splitRemote(filename)
  const ext = extOf(name)
  const direct = [path.join(downloadsDir, folder, name), path.join(downloadsDir, name)]
  for (const candidate of direct) {
    try { if (fs.statSync(candidate).isFile()) return candidate } catch {}
  }
  let best = null
  const walk = (dir, depth) => {
    if (depth > 4) return
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      if (extOf(entry.name) !== ext) continue
      let stat
      try { stat = fs.statSync(full) } catch { continue }
      if (entry.name === name && (!size || stat.size === Number(size))) { best = { full, rank: 3, mtime: stat.mtimeMs }; continue }
      if (size && stat.size === Number(size) && stat.mtimeMs >= since - 60000) {
        const rank = 2
        if (!best || rank > best.rank || (rank === best.rank && stat.mtimeMs > best.mtime)) best = { full, rank, mtime: stat.mtimeMs }
      }
    }
  }
  walk(downloadsDir, 0)
  return best?.full || null
}

module.exports = {
  config, status, startSearch, searchResults, stopSearch, enqueue, findTransfer, cancelTransfer,
  describeState, locateDownload, splitRemote, flatten, SlskdError, AUDIO_EXT, LOSSLESS_EXT,
}
