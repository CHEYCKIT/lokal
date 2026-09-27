// Moving covers: the looping clips Apple Music shows instead of a still album
// cover. Ported from BitChord's canvas pipeline (Apple first, then Tidal,
// then a community list, then -- opt-in, with your own cookie -- Spotify
// Canvas; see spotify.js).
//
// None of these are official public APIs:
//   - Apple: the web player's own token, read from music.apple.com's script
//     bundle, used against Apple's catalogue API (amp-api) for an album's
//     "editorialVideo";
//   - Tidal: the token Tidal's embed player ships with, for an album's
//     "videoCover";
//   - community: a list of clips kept by BitChord's community on a
//     Cloudflare worker.
// Any of them may stop working without notice; a failure is simply "no
// moving cover" and the still artwork stays.
//
// A match must have exactly the same title (and album, where both sides know
// it) and every one of the track's artists -- a wrong clip is worse than none.
// Clips are saved as MP4 in a capped cache (Apple's HLS streams are remuxed
// with ffmpeg, no re-encoding), so each plays from disk after the first time.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const TIDAL_TOKEN = 'vNVdglQOjFJJGG2U'
const COMMUNITY_URL = 'https://vivimusicanvas.mkmdevilmi.workers.dev/canvas.json'
const SOURCES = ['apple', 'tidal', 'community', 'spotify']
const DEFAULT_SOURCES = ['apple', 'tidal', 'community'] // Spotify needs a cookie, so it's opt-in
const HIT_TTL = 30 * 24 * 3600 * 1000
const MISS_TTL = 3 * 24 * 3600 * 1000
const CACHE_LIMIT_BYTES = 600 * 1024 * 1024

// ---------------------------------------------------------------- matching

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// "(Official Video)", "[Lyrics]", "| Topic"... the song itself, not the upload.
const NOISE = /\s*[([][^)\]]*(?:official|lyric|audio|video|visuali[sz]er|hd|4k|mv)[^)\]]*[)\]]|\s*\|.*$/gi

function cleanTitle(title) {
  return String(title || '').replace(NOISE, '').trim()
}

function splitArtists(s) {
  return String(s || '')
    .split(/\s*(?:,|&|×|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|;|\/)\s*/i)
    .map(norm)
    .filter(Boolean)
}

function artistsMatch(wanted, got) {
  const want = splitArtists(wanted)
  const have = new Set((Array.isArray(got) ? got : [got]).flatMap(splitArtists))
  const joined = [...have].join(' ')
  return want.length > 0 && want.every(a => have.has(a) || joined.includes(a))
}

// ---------------------------------------------------------------- http

async function getJson(url, headers = {}, timeoutMs = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: controller.signal })
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e }
    return await res.json()
  } finally { clearTimeout(timer) }
}

async function getText(url, timeoutMs = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally { clearTimeout(timer) }
}

// ---------------------------------------------------------------- Apple

let appleToken = null // { jwt, exp }
let appleTokenFailedAt = 0
const badTokens = new Set()

function decodeJwt(jwt) {
  try {
    const [h, p] = jwt.split('.')
    return { header: Buffer.from(h, 'base64url').toString(), payload: JSON.parse(Buffer.from(p, 'base64url').toString()) }
  } catch { return null }
}

async function appleJwt() {
  if (appleToken && appleToken.exp * 1000 > Date.now() + 60000) return appleToken.jwt
  if (Date.now() - appleTokenFailedAt < 30 * 60 * 1000) return null
  try {
    const html = await getText('https://music.apple.com/us/browse')
    const bundles = [...new Set(html.match(/\/assets\/index(?:-legacy)?[~-][A-Za-z0-9_-]+\.js/g) || [])]
    for (const bundle of bundles) {
      const js = await getText(`https://music.apple.com${bundle}`, 20000)
      for (const jwt of js.match(/ey[\w-]+\.ey[\w-]+\.[\w-]+/g) || []) {
        if (badTokens.has(jwt)) continue
        const d = decodeJwt(jwt)
        if (!d?.payload?.exp || d.payload.exp * 1000 < Date.now()) continue
        if (!/WebPlay/.test(d.header) && !/WebPlay/.test(JSON.stringify(d.payload))) continue
        appleToken = { jwt, exp: d.payload.exp }
        return jwt
      }
    }
  } catch {}
  appleTokenFailedAt = Date.now()
  return null
}

async function appleGet(url) {
  const jwt = await appleJwt()
  if (!jwt) return null
  try {
    return await getJson(url, { Authorization: `Bearer ${jwt}`, Origin: 'https://music.apple.com', Referer: 'https://music.apple.com/' })
  } catch (e) {
    if (e.status === 401) { badTokens.add(jwt); appleToken = null }
    return null
  }
}

const COMPILATION = /playlist|set list|essentials|dj mix|mixed|apple music|today's hits|session/i
const EDITION = /deluxe|expanded|remaster|remix|version|edit|mix|bonus/i

function pickRendition(video) {
  if (!video) return null
  const order = ['motionDetailSquare', 'motionSquareVideo1x1', 'motionDetailRaw', 'motionDetailTall', 'motionTallVideo3x4']
  for (const key of order) {
    const v = video[key]
    const url = v && (v.video || v.videoUrl || v.hlsUrl || v.url)
    if (url) return { url, tall: /Tall|3x4/.test(key) }
  }
  return null
}

async function fromApple({ title, artist, album }, storefront = 'us') {
  const term = [artist, cleanTitle(title), album].filter(Boolean).join(' ')
  const base = `https://amp-api.music.apple.com/v1/catalog/${storefront}`
  const res = await appleGet(`${base}/search?term=${encodeURIComponent(term)}&types=songs&limit=10&extend=editorialVideo&include=albums`)
  const songs = res?.results?.songs?.data || []
  const wantTitle = norm(cleanTitle(title))
  const wantAlbum = norm(album)
  let best = null
  for (const song of songs) {
    const a = song.attributes || {}
    if (COMPILATION.test(a.albumName || '')) continue
    if (!artistsMatch(artist, a.artistName)) continue
    const t = norm(a.name)
    let score = 10 + (t === wantTitle ? 15 : (t.includes(wantTitle) || wantTitle.includes(t)) ? 7 : -10)
    const al = norm(a.albumName)
    if (wantAlbum) score += al === wantAlbum ? 20 : (al.includes(wantAlbum) || wantAlbum.includes(al)) ? 10 : 0
    const editionHere = EDITION.test(a.albumName || '')
    if (editionHere) score += EDITION.test(album || '') ? 5 : -3
    if (score >= 12 && (!best || score > best.score)) best = { song, score }
  }
  if (!best) return null
  let video = best.song.attributes?.editorialVideo
  if (!pickRendition(video)) {
    const albumId = best.song.relationships?.albums?.data?.[0]?.id || String(best.song.attributes?.url || '').match(/\/album\/[^?]*?(\d+)(?:\?|$)/)?.[1]
    if (!albumId || String(albumId).startsWith('pl.')) return null
    const albumRes = await appleGet(`${base}/albums/${albumId}?extend=editorialVideo`)
    video = albumRes?.data?.[0]?.attributes?.editorialVideo
  }
  const pick = pickRendition(video)
  return pick ? { url: pick.url, kind: 'hls', source: 'apple', tall: pick.tall } : null
}

// ---------------------------------------------------------------- Tidal

async function fromTidal({ title, artist, album }, country = 'US') {
  const q = [album, artist, cleanTitle(title)].filter(Boolean).join(' ')
  const res = await getJson(`https://api.tidal.com/v1/search?query=${encodeURIComponent(q)}&limit=10&types=TRACKS&countryCode=${country}`, { 'X-Tidal-Token': TIDAL_TOKEN }).catch(() => null)
  const wantTitle = norm(cleanTitle(title))
  const wantAlbum = norm(album)
  for (const t of res?.tracks?.items || []) {
    if (norm(t.title) !== wantTitle) continue
    if (!artistsMatch(artist, (t.artists || []).map(a => a.name))) continue
    if (wantAlbum && t.album?.title && norm(t.album.title) !== wantAlbum) continue
    const uuid = t.album?.videoCover
    if (!uuid || uuid.split('-').length !== 5) continue
    return { url: `https://resources.tidal.com/videos/${uuid.split('-').join('/')}/1280x1280.mp4`, kind: 'mp4', source: 'tidal', tall: false }
  }
  return null
}

// ---------------------------------------------------------------- community

let community = { at: 0, items: [] }
async function fromCommunity({ title, artist, album }) {
  if (Date.now() - community.at > 30 * 60 * 1000) {
    try {
      const data = await getJson(COMMUNITY_URL, {}, 15000)
      community = { at: Date.now(), items: Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [] }
    } catch { community.at = Date.now() - 25 * 60 * 1000 }
  }
  const wantTitle = norm(cleanTitle(title))
  const wantAlbum = norm(album)
  for (const item of community.items) {
    const t = norm(item.song)
    if (!t || !(t === wantTitle || t.includes(wantTitle) || wantTitle.includes(t))) continue
    if (!artistsMatch(artist, item.artist) && !artistsMatch(item.artist, artist)) continue
    if (item.album && wantAlbum && norm(item.album) !== wantAlbum) continue
    if (item.url) return { url: item.url, kind: /\.m3u8(?:[?#]|$)/i.test(item.url) ? 'hls' : 'mp4', source: 'community', tall: false }
  }
  return null
}

function firstArtist(s) {
  return String(s || '').split(/\s*(?:,|&|×|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|;|\/)\s*/i)[0].trim()
}

function fromSpotifyCanvas(track, settings) {
  if (!settings.spotify_sp_dc) return null
  // Any failure here is Spotify's (cookie, token, rate limit), not proof the
  // song has no canvas -- so never let it be remembered as a miss.
  return Promise.resolve()
    .then(() => require('./spotify').fromSpotify(track, settings, { norm, cleanTitle, artistsMatch, splitFirstArtist: firstArtist }))
    .catch(e => { const err = e instanceof Error ? e : new Error(String(e)); err.transient = true; throw err })
}

const PROVIDERS = { apple: fromApple, tidal: fromTidal, community: fromCommunity, spotify: fromSpotifyCanvas }

// ---------------------------------------------------------------- clip cache

function run(ffmpeg, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let proc
    try { proc = spawn(ffmpeg || 'ffmpeg', args, { windowsHide: true }) } catch (e) { reject(e); return }
    let err = ''
    const timer = setTimeout(() => { try { proc.kill('SIGKILL') } catch {} }, timeoutMs)
    proc.stderr.on('data', d => { err = (err + d).slice(-1000) })
    proc.on('error', e => { clearTimeout(timer); reject(e) })
    proc.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `ffmpeg ${code}`)) })
  })
}

/** An HLS master playlist's H.264 variant closest to (at least) `target` pixels. */
async function chooseVariant(masterUrl, target = 768) {
  const text = await getText(masterUrl)
  const lines = text.split(/\r?\n/)
  const variants = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#EXT-X-STREAM-INF:(.*)$/)
    if (!m) continue
    const attrs = m[1]
    const uri = lines.slice(i + 1).find(l => l && !l.startsWith('#'))
    const codecs = (attrs.match(/CODECS="([^"]+)"/) || [])[1] || ''
    const res = (attrs.match(/RESOLUTION=(\d+)x(\d+)/) || []).slice(1).map(Number)
    if (!uri || !/avc1/.test(codecs)) continue // Chromium plays H.264, not HEVC
    variants.push({ uri: new URL(uri, masterUrl).href, width: res[0] || 0, height: res[1] || 0 })
  }
  if (!variants.length) return masterUrl
  const big = variants.filter(v => Math.min(v.width, v.height) >= target).sort((a, b) => a.width * a.height - b.width * b.height)
  return (big[0] || variants.sort((a, b) => b.width * b.height - a.width * a.height)[0]).uri
}

async function download(url, dest, timeoutMs = 60000) {
  // The timer covers the body too, so a stalled transfer can't leave the
  // clip's in-flight promise hanging forever.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 1024) throw new Error('empty clip')
    fs.writeFileSync(dest, buf)
  } finally {
    clearTimeout(timer)
  }
}

function trimCache(dir, keep) {
  let entries = []
  try {
    entries = fs.readdirSync(dir).filter(f => f.endsWith('.mp4')).map(f => {
      const p = path.join(dir, f)
      const s = fs.statSync(p)
      return { p, size: s.size, used: s.atimeMs || s.mtimeMs }
    }).sort((a, b) => b.used - a.used)
  } catch { return }
  let total = 0
  for (const e of entries) {
    total += e.size
    if (total > CACHE_LIMIT_BYTES && e.p !== keep) { try { fs.unlinkSync(e.p) } catch {} }
  }
}

const inFlight = new Map()

/** The clip as an MP4 file in the cache (fetched/remuxed once). */
async function cachedClip(found, { cacheDir, ffmpeg }) {
  fs.mkdirSync(cacheDir, { recursive: true })
  const dest = path.join(cacheDir, crypto.createHash('sha1').update(found.url).digest('hex').slice(0, 20) + '.mp4')
  if (fs.existsSync(dest)) {
    try { const now = new Date(); fs.utimesSync(dest, now, now) } catch {}
    return dest
  }
  if (inFlight.has(dest)) return inFlight.get(dest)
  const job = (async () => {
    const temp = `${dest}.part.mp4`
    try {
      if (found.kind === 'hls') {
        const variant = await chooseVariant(found.url)
        await run(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', variant, '-map', '0:v:0', '-c', 'copy', '-an', '-movflags', '+faststart', temp])
      } else {
        await download(found.url, temp)
      }
      fs.renameSync(temp, dest)
      trimCache(cacheDir, dest)
      return dest
    } catch {
      try { fs.unlinkSync(temp) } catch {}
      return null
    }
  })().finally(() => inFlight.delete(dest))
  inFlight.set(dest, job)
  return job
}

// ---------------------------------------------------------------- lookup

function ensureTable(db) {
  db.exec('CREATE TABLE IF NOT EXISTS motion_covers (key TEXT PRIMARY KEY, data TEXT, fetched_at INTEGER)')
}

function keyFor({ title, artist, album }) {
  return `${norm(cleanTitle(title))}|${norm(artist)}|${norm(album)}`
}

function enabledSources(settings) {
  let list = null
  try { list = JSON.parse(settings.motion_cover_sources || 'null') } catch {}
  const chosen = Array.isArray(list) ? list : DEFAULT_SOURCES
  // Always in the same order, whatever order they were switched on in --
  // except that Spotify can be asked first ("Prioritize Spotify Canvas").
  const order = SOURCES.filter(s => chosen.includes(s) && (s !== 'spotify' || settings.spotify_sp_dc))
  if (settings.spotify_canvas_first === '1' && order.includes('spotify')) return ['spotify', ...order.filter(s => s !== 'spotify')]
  return order
}

/**
 * @returns {Promise<{ file: string, source: string, tall: boolean } | null>}
 */
async function motionCoverFor(db, track, { settings = {}, cacheDir, ffmpeg } = {}) {
  if (!track?.title || !track?.artist) return null
  if (settings.motion_covers === '0') return null
  const sources = enabledSources(settings)
  if (!sources.length) return null
  ensureTable(db)
  const key = keyFor(track) + `|${sources.join(',')}`
  const row = db.prepare('SELECT data, fetched_at FROM motion_covers WHERE key = ?').get(key)
  let found
  if (row) {
    const data = row.data ? JSON.parse(row.data) : null
    const fresh = Date.now() - row.fetched_at < (data ? HIT_TTL : MISS_TTL)
    if (fresh) found = data
  }
  if (found === undefined) {
    found = null
    let unsure = false // a source failed on its end: don't remember this as "none"
    for (const id of sources) {
      try { found = await PROVIDERS[id](track, settings) } catch (e) { found = null; if (e?.transient) unsure = true }
      if (found) break
    }
    if (found || !unsure) db.prepare('INSERT OR REPLACE INTO motion_covers (key, data, fetched_at) VALUES (?, ?, ?)').run(key, found ? JSON.stringify(found) : null, Date.now())
  }
  if (!found) return null
  const file = await cachedClip(found, { cacheDir, ffmpeg })
  return file ? { file, source: found.source, tall: !!found.tall } : null
}

module.exports = { motionCoverFor, fromApple, fromTidal, fromCommunity, artistsMatch, cleanTitle, norm, chooseVariant, SOURCES, DEFAULT_SOURCES }
