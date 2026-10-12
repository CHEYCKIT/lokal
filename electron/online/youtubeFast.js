// YouTube's audio, looked up in Lokal itself instead of through yt-dlp: one
// request to YouTube Music's own player API (youtubei.js), the link decoded
// with YouTube's player script, and a proof-of-origin token (poToken.js) so
// YouTube serves the whole song. About a tenth of a second, against the few
// seconds it takes to start yt-dlp. Anything it can't do (a song that needs
// the account, a refused link) falls back to yt-dlp (youtube.js).
//
// YouTube's player script runs in a sandboxed hidden window, never in this
// (Node) process.

const MUSIC_HOME = 'https://music.youtube.com/'
const CLIENT_TTL_MS = 6 * 60 * 60 * 1000
const EVAL_PARTITION = 'lokal-youtube-player' // in memory: nothing kept
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

let clientJob = null // Promise<{ yt, at }>
let evalWindow = null
let queue = Promise.resolve()

// ------------------------------------------------------------ the player script, sandboxed

function sandbox() {
  if (evalWindow && !evalWindow.isDestroyed()) return evalWindow.ready
  const { BrowserWindow } = require('electron')
  const win = new BrowserWindow({
    show: false, width: 100, height: 100, skipTaskbar: true,
    webPreferences: { partition: EVAL_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.on('closed', () => { if (evalWindow === win) evalWindow = null })
  win.ready = win.loadURL('about:blank').then(() => win)
  evalWindow = win
  return win.ready
}

/** youtubei.js's evaluator: the decoding script, run in the sandbox; plain data back. */
async function evaluate(data) {
  const win = await sandbox()
  return win.webContents.executeJavaScript(`(function () {\n${data.output}\n})()`, true)
}

// ------------------------------------------------------------ the YouTube Music client

function library() {
  const youtubei = require('youtubei.js')
  youtubei.Platform.shim.eval = evaluate
  return youtubei
}

/** The music.youtube.com client version in use today (youtubei.js ships an old one). */
async function liveClientVersion(fetchImpl) {
  try {
    const page = await (await fetchImpl(MUSIC_HOME, { headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en-US,en;q=0.9' } })).text()
    return page.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] || null
  } catch { return null }
}

async function createClient(fetchImpl) {
  const { Innertube, ClientType } = library()
  // A visitor id YouTube issued (not one made up locally): what a token is bound alongside.
  const bootstrap = await Innertube.create({ fetch: fetchImpl, retrieve_player: false, generate_session_locally: false, retrieve_innertube_config: false })
  const yt = await Innertube.create({
    fetch: fetchImpl, retrieve_player: true, generate_session_locally: false, retrieve_innertube_config: false,
    visitor_data: bootstrap.session.context.client.visitorData, client_type: ClientType.MUSIC,
  })
  const version = await liveClientVersion(fetchImpl)
  if (version) yt.session.context.client.clientVersion = version
  return yt
}

function client(fetchImpl) {
  if (!clientJob) {
    const job = createClient(fetchImpl).then(yt => ({ yt, at: Date.now() }))
    job.catch(() => { if (clientJob === job) clientJob = null }) // offline at launch: try again next time
    clientJob = job
  }
  return clientJob.then(entry => {
    if (Date.now() - entry.at < CLIENT_TTL_MS) return entry.yt
    clientJob = null
    return client(fetchImpl)
  })
}

// ------------------------------------------------------------ picking and finishing the link

/** The audio format for the quality: the highest bitrate, or for "saver" the lowest. */
function pickAudioFormat(formats, quality = 'best') {
  const audio = (formats || []).filter(format => String(format?.mime_type || '').startsWith('audio/') && !format.is_drc)
  if (!audio.length) return null
  const byBitrate = [...audio].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
  return quality === 'saver' ? byBitrate[byBitrate.length - 1] : byBitrate[0]
}

/**
 * The link's `cver` set to the session's client version: youtubei.js stamps
 * its own built-in one when it decodes, and a link claiming another client
 * than the request that made it is refused. Not part of the signature; done
 * as text so the rest of the (exact, signed) query is left alone.
 */
function withClientVersion(url, version) {
  if (!version) return url
  return String(url).replace(/([?&]cver=)[^&]*/, `$1${encodeURIComponent(version)}`)
}

function expiryOf(url) {
  const seconds = Number(String(url).match(/[?&]expire=(\d+)/)?.[1])
  return seconds > 0 ? seconds * 1000 - 60000 : Date.now() + 5 * 60 * 60 * 1000
}

function describe(format) {
  const codec = String(format.mime_type || '').match(/codecs="([^".]+)/)?.[1] || null
  const kbps = format.bitrate ? `${Math.round(format.bitrate / 1000)} kbps` : null
  return [codec, kbps].filter(Boolean).join(' ') || null
}

// ------------------------------------------------------------ resolving

/**
 * `videoId`'s audio stream: { url, headers, mime, format, expiresAt, engine }.
 * Throws when YouTube won't play it this way (yt-dlp is tried then).
 */
function resolveAudio(videoId, { quality = 'best', fetchImpl = (...args) => fetch(...args), mint = id => require('./poToken').mint(id), clientFor = client } = {}) {
  // One at a time: the token lives on the shared session while a link is made.
  const job = queue.then(async () => {
    const yt = await clientFor(fetchImpl)
    const poToken = await mint(videoId)
    yt.session.po_token = poToken
    if (yt.session.player) yt.session.player.po_token = poToken
    const info = await yt.getBasicInfo(videoId, poToken ? { po_token: poToken } : undefined)
    const status = info?.playability_status?.status
    if (status && status !== 'OK') throw new Error(`YouTube: ${info.playability_status.reason || status}`)
    const format = pickAudioFormat(info?.streaming_data?.adaptive_formats, quality)
    if (!format) throw new Error('YouTube offered no audio for this song.')
    const url = withClientVersion(await format.decipher(yt.session.player), yt.session.context.client.clientVersion)
    if (!/^https:\/\//.test(url)) throw new Error('YouTube gave no stream link.')
    const mime = String(format.mime_type).split(';')[0].trim() || 'audio/*'
    return { url, headers: {}, mime, format: describe(format), expiresAt: expiryOf(url), engine: 'youtubei', poToken: !!poToken }
  })
  queue = job.catch(() => {})
  return job
}

/** Set up the client and the attestation ahead of the first song. */
function warm({ fetchImpl = (...args) => fetch(...args) } = {}) {
  client(fetchImpl).catch(() => {})
  require('./poToken').warm()
}

function forget() {
  clientJob = null
  queue = Promise.resolve()
  if (evalWindow && !evalWindow.isDestroyed()) evalWindow.destroy()
  evalWindow = null
}

module.exports = { resolveAudio, warm, forget, pickAudioFormat, withClientVersion, expiryOf, evaluate }
