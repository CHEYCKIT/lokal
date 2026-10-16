// YouTube's audio, looked up in Lokal itself instead of through yt-dlp: one
// request to YouTube Music's own player API (youtubei.js), the link decoded
// with YouTube's player script, and a proof-of-origin token (poToken.js) so
// YouTube serves the whole song. About a tenth of a second, against the few
// seconds it takes to start yt-dlp. Anything it can't do (a song that needs
// the account, a refused link) falls back to yt-dlp (youtube.js). Music
// videos' pictures (resolveVideo) come the same way.
//
// YouTube's player script runs in a sandboxed hidden window, never in this
// (Node) process.

const MUSIC_HOME = 'https://music.youtube.com/'
const CLIENT_TTL_MS = 6 * 60 * 60 * 1000
const EVAL_PARTITION = 'lokal-youtube-player' // in memory: nothing kept
const EVAL_WINDOW_IDLE_MS = 10 * 60 * 1000
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

let clientJob = null // Promise<{ yt, at }>
let evalWindow = null
let evalWindowIdleTimer = null
let queue = Promise.resolve()

// ------------------------------------------------------------ the player script, sandboxed

function scheduleEvalWindowDestroy(win) {
  if (evalWindowIdleTimer) clearTimeout(evalWindowIdleTimer)
  evalWindowIdleTimer = setTimeout(() => {
    if (evalWindow !== win || win.isDestroyed()) return
    evalWindow = null
    evalWindowIdleTimer = null
    win.destroy()
  }, EVAL_WINDOW_IDLE_MS)
  evalWindowIdleTimer.unref?.()
}

function sandbox() {
  if (evalWindow && !evalWindow.isDestroyed()) {
    scheduleEvalWindowDestroy(evalWindow)
    return evalWindow.ready
  }
  const { BrowserWindow } = require('electron')
  const win = new BrowserWindow({
    show: false, width: 100, height: 100, skipTaskbar: true,
    webPreferences: { partition: EVAL_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.on('closed', () => {
    if (evalWindow !== win) return
    evalWindow = null
    if (evalWindowIdleTimer) clearTimeout(evalWindowIdleTimer)
    evalWindowIdleTimer = null
  })
  win.ready = win.loadURL('about:blank').then(() => { scheduleEvalWindowDestroy(win); return win })
  evalWindow = win
  return win.ready
}

/** youtubei.js's evaluator: the decoding script, run in the sandbox; plain data back. */
async function evaluate(data) {
  const win = await sandbox()
  scheduleEvalWindowDestroy(win)
  try {
    const script = '(function () {\n' + data.output + '\n})()'
    return await win.webContents.executeJavaScript(script, true)
  } finally {
    if (evalWindow === win && !win.isDestroyed()) scheduleEvalWindowDestroy(win)
  }
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

// The YouTube Music account signed in to Lokal (youtubeSession.js), for a
// video YouTube won't give a signed-out client ("Sign in to confirm you're
// not a bot"): async () => { fetchImpl } (music.youtube.com requests only),
// or null when not signed in.
let account = null
let signedJob = null // Promise<{ yt, at }>
function setAccount(provider) { account = provider; signedJob = null }

/** A fetch whose YouTube Music API requests go out as the account. */
function accountFetch(credentials) {
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || String(input)
    if (!/^https:\/\/music\.youtube\.com\/youtubei\//.test(url)) return fetch(input, init)
    if (typeof input !== 'string' && input?.url) {
      init = { method: input.method, headers: Object.fromEntries(input.headers.entries()), body: input.method === 'POST' ? await input.text() : undefined, ...init }
    }
    const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : { ...(init.headers || {}) }
    return credentials.fetchImpl(url, { ...init, headers })
  }
}

async function signedClient() {
  const credentials = account ? await account().catch(() => null) : null
  if (!credentials?.fetchImpl) return null
  if (!signedJob) {
    const { Innertube, ClientType } = library()
    const job = Innertube.create({ fetch: accountFetch(credentials), retrieve_player: true, generate_session_locally: true, retrieve_innertube_config: false, client_type: ClientType.MUSIC })
      .then(yt => ({ yt, at: Date.now() }))
    job.catch(() => { if (signedJob === job) signedJob = null })
    signedJob = job
  }
  const entry = await signedJob
  if (Date.now() - entry.at < CLIENT_TTL_MS) return entry.yt
  signedJob = null
  return signedClient()
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

const VIDEO_CODECS = [/^avc1/, /^vp0?9/] // H.264 first (hardware decoding), then VP9

function codecOf(format) {
  return String(format?.mime_type || '').match(/codecs="([^"]+)"/)?.[1] || ''
}

/**
 * A music video's picture, capped at `height` (Settings -> Playback -> Music
 * Video Quality), the same order as yt-dlp's (youtube.js videoFormatArgs):
 * the tallest picture-only format within the cap, H.264 before VP9 before
 * the rest at a height; then a format with sound within the cap; then the
 * smallest picture over it. It plays muted under the song's own audio.
 */
function pickVideoFormat(adaptive, muxed, height = 1080) {
  const cap = [1080, 720, 480].includes(Number(height)) ? Number(height) : 1080
  const isVideo = format => String(format?.mime_type || '').startsWith('video/') && format.height > 0
  const rank = format => { const i = VIDEO_CODECS.findIndex(codec => codec.test(codecOf(format))); return i < 0 ? VIDEO_CODECS.length : i }
  const best = list => [...list].sort((a, b) => (b.height - a.height) || (rank(a) - rank(b)) || ((b.bitrate || 0) - (a.bitrate || 0)))[0] || null
  const pictures = (adaptive || []).filter(isVideo)
  const withSound = (muxed || []).filter(isVideo)
  return best(pictures.filter(format => format.height <= cap))
    || best(withSound.filter(format => format.height <= cap))
    || [...pictures, ...withSound].sort((a, b) => a.height - b.height)[0]
    || null
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

/** The `cver` YouTube put in a format's link, before youtubei.js decodes it. */
function serverClientVersion(format) {
  const raw = String(format?.url || format?.signature_cipher || format?.cipher || '')
  let text = raw
  try { text = decodeURIComponent(raw) } catch {}
  const found = text.match(/[?&]cver=([^&]+)/)?.[1]
  try { return found ? decodeURIComponent(found) : null } catch { return found || null }
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

/** `videoId`'s player response with a token, its link chosen by `pick`. One at a time. */
function resolveWith(videoId, pick, { fetchImpl = (...args) => fetch(...args), mint = id => require('./poToken').mint(id), clientFor = client, as = null } = {}) {
  // One at a time: the token lives on the shared session while a link is made.
  const job = queue.then(async () => {
    const yt = await clientFor(fetchImpl)
    const poToken = await mint(videoId)
    yt.session.po_token = poToken
    if (yt.session.player) yt.session.player.po_token = poToken
    // `as`: another of YouTube's clients than the session's own (YouTube Music).
    const options = { ...(poToken ? { po_token: poToken } : {}), ...(as ? { client: as } : {}) }
    const info = await yt.getBasicInfo(videoId, Object.keys(options).length ? options : undefined)
    const status = info?.playability_status?.status
    if (status && status !== 'OK') throw new Error(`YouTube: ${info.playability_status.reason || status}`)
    const { format, stream } = pick(info?.streaming_data || {})
    // The link names the client version that asked for it: the one YouTube
    // put in it (youtubei.js stamps its own while decoding); without one, the
    // session's (today's, createClient) for its own client.
    const asked = serverClientVersion(format)
    const deciphered = await format.decipher(yt.session.player)
    const url = asked ? withClientVersion(deciphered, asked) : as ? deciphered : withClientVersion(deciphered, yt.session.context.client.clientVersion)
    if (!/^https:\/\//.test(url)) throw new Error('YouTube gave no stream link.')
    return { url, headers: {}, ...stream, expiresAt: expiryOf(url), engine: 'youtubei', poToken: !!poToken }
  })
  queue = job.catch(() => {})
  return job
}

/**
 * `videoId`'s audio stream: { url, headers, mime, format, expiresAt, engine }.
 * Throws when YouTube won't play it this way (yt-dlp is tried then).
 */
function resolveAudio(videoId, { quality = 'best', ...options } = {}) {
  return resolveWith(videoId, data => {
    const format = pickAudioFormat(data.adaptive_formats, quality)
    if (!format) throw new Error('YouTube offered no audio for this song.')
    return { format, stream: { mime: String(format.mime_type).split(';')[0].trim() || 'audio/*', format: describe(format) } }
  }, options)
}

/**
 * A music video's picture, at most `height` tall: { url, headers, mime,
 * format ("avc1 1080p"), expiresAt, engine }. Throws like resolveAudio.
 */
async function resolveVideo(videoId, { height = 1080, clients = VIDEO_CLIENTS, ...options } = {}) {
  const pick = data => {
    const format = pickVideoFormat(data.adaptive_formats, data.formats, height)
    if (!format) throw new Error('no picture')
    const codec = codecOf(format).split('.')[0] || null
    return { format, stream: { mime: /webm/.test(format.mime_type) ? 'video/webm' : 'video/mp4', format: [codec, `${format.height}p`].filter(Boolean).join(' ') } }
  }
  // YouTube Music's client first, signed out then as the account (a video
  // YouTube puts behind "confirm you're not a bot"); then YouTube's mobile
  // web client the same two ways, for one it gives no picture for.
  const signed = options.signedClient || signedClient
  const tried = []
  for (const as of clients) {
    for (const asAccount of [false, true]) {
      let clientFor = options.clientFor
      if (asAccount) {
        const yt = await signed().catch(() => null)
        if (!yt) continue
        clientFor = async () => yt
      }
      try { return await resolveWith(videoId, pick, { ...options, ...(clientFor ? { clientFor } : {}), as }) } catch (error) {
        tried.push(`${as || 'YouTube Music'}${asAccount ? ' signed in' : ''}: ${String(error?.message || error).replace(/^YouTube: /, '').slice(0, 120)}`)
      }
    }
  }
  throw new Error(`YouTube offered no picture for this video (${tried.join('; ')})`)
}
const VIDEO_CLIENTS = [null, 'MWEB']

/** Set up the client and the attestation ahead of the first song. */
function warm({ fetchImpl = (...args) => fetch(...args) } = {}) {
  client(fetchImpl).catch(() => {})
  // Proof-of-origin windows are created on demand during token mint.
}

function forget() {
  clientJob = null
  signedJob = null
  queue = Promise.resolve()
  if (evalWindowIdleTimer) clearTimeout(evalWindowIdleTimer)
  evalWindowIdleTimer = null
  if (evalWindow && !evalWindow.isDestroyed()) evalWindow.destroy()
  evalWindow = null
}

module.exports = { resolveAudio, resolveVideo, setAccount, warm, forget, pickAudioFormat, pickVideoFormat, withClientVersion, expiryOf, evaluate }
