// Audio Lokal's player (Chromium) can't decode, made playable with ffmpeg.
//
// Apple Lossless (ALAC) is the common case: .m4a files from Soulseek and
// iTunes rips are often ALAC, and Chromium has no ALAC decoder, so they
// don't play at all. Lossless sources become FLAC (nothing is lost); lossy
// ones Chromium can't read (WMA...) become AAC.
//
//  - downloads: ALAC is converted to FLAC as the file lands;
//  - library files: when the player can't open one, a playable copy is made
//    once in a cache and played instead (the original is left untouched).

const { spawn, execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

let mm = null
function metadata() {
  if (mm === null) {
    try { mm = require('../musicMetadata') } catch { mm = false }
  }
  return mm || null
}

/** Codecs Chromium can't play, by music-metadata's codec name. */
const ALAC_CODEC = /^(?:ALAC|Apple\s+Lossless(?:\s+Audio\s+Codec)?)/i
const UNPLAYABLE = /^(?:ALAC|Apple\s+Lossless(?:\s+Audio\s+Codec)?|APE|Monkey|WavPack|TTA|WMA|Windows Media|DSD|DST|MLP|TrueHD|AC-?3|E-AC-?3|DTS)/i
const LOSSLESS = /^(?:ALAC|Apple\s+Lossless(?:\s+Audio\s+Codec)?|APE|Monkey|WavPack|TTA|DSD|DST|MLP|TrueHD|FLAC|PCM)/i

// music-metadata versions and container parsers don't always spell the ALAC
// codec identically: some report `ALAC`, others `Apple Lossless`. Both mean
// Chromium needs the same lossless-to-FLAC fallback. Keep classification in
// one place so those aliases can't be marked playable by accident.
function classifyCodec(codecValue, formatLossless = false, containerValue = '') {
  const codec = String(codecValue || '').trim() || String(containerValue || '').trim()
  return {
    codec,
    lossless: !!formatLossless || LOSSLESS.test(codec),
    unplayable: UNPLAYABLE.test(codec),
  }
}

/**
 * On macOS, try Core Audio first for ALAC. If that fails, FFmpeg is the
 * fallback when installed. Other unsupported codecs require FFmpeg directly.
 */
function playbackCopyPlans(info, ffmpeg, platform = process.platform) {
  const ffmpegPlan = { converter: 'ffmpeg', extension: info?.lossless ? '.flac' : '.m4a' }
  if (platform === 'darwin' && ALAC_CODEC.test(String(info?.codec || ''))) {
    return [
      { converter: 'afconvert', extension: '.wav' },
      ...(ffmpeg ? [ffmpegPlan] : []),
    ]
  }
  return [ffmpegPlan]
}

function playbackCopyPlan(info, ffmpeg, platform = process.platform) {
  return playbackCopyPlans(info, ffmpeg, platform)[0]
}

function afconvertArgs(src, dest) {
  return ['-f', 'WAVE', '-d', 'LEF32', src, dest]
}

// Before conversion, report a missing required dependency. For macOS ALAC,
// afconvert must get a chance first; only report missing FFmpeg after it fails.
function playbackCopyFailure(info, ffmpeg, platform = process.platform, afconvertFailed = false) {
  if (!info?.unplayable) return null
  const plan = playbackCopyPlan(info, ffmpeg, platform)
  if (!ffmpeg && plan.converter === 'ffmpeg') return 'ffmpeg-missing'
  if (!ffmpeg && plan.converter === 'afconvert' && afconvertFailed) return 'ffmpeg-missing'
  return null
}

function discoverFfmpeg() {
  // In Electron this finds app-managed, bundled and user-configured binaries.
  try {
    const executable = require('../ipc/tools').findFfmpeg()
    if (executable) return executable
  } catch {}

  // The standalone web server may run outside Electron, where app.getPath()
  // is unavailable. Still honor a system ffmpeg on PATH in that environment.
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 3000 })
    return 'ffmpeg'
  } catch {
    return null
  }
}

let defaultFfmpegResolved = false
let defaultFfmpegPath = null

function resolveFfmpeg(ffmpeg, discover = discoverFfmpeg) {
  if (ffmpeg) return ffmpeg
  // Injectable lookup makes the availability decision deterministic in tests.
  if (discover !== discoverFfmpeg) {
    try { return discover() || null } catch { return null }
  }
  if (!defaultFfmpegResolved) {
    try { defaultFfmpegPath = discoverFfmpeg() || null } catch { defaultFfmpegPath = null }
    defaultFfmpegResolved = true
  }
  return defaultFfmpegPath
}

async function probe(filePath) {
  const lib = metadata()
  if (!lib) return null
  try {
    const meta = await lib.parseFile(filePath, { duration: false, skipCovers: true })
    return classifyCodec(meta?.format?.codec, meta?.format?.lossless, meta?.format?.container)
  } catch { return null }
}

function run(ffmpeg, args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    let err = ''
    let proc
    try { proc = spawn(ffmpeg || 'ffmpeg', args, { windowsHide: true }) } catch (e) { reject(e); return }
    const timer = setTimeout(() => { try { proc.kill('SIGKILL') } catch {} }, timeoutMs)
    proc.stderr.on('data', d => { err = (err + d.toString()).slice(-2000) })
    proc.on('error', e => { clearTimeout(timer); reject(e) })
    proc.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited with ${code}`))
    })
  })
}

/** ffmpeg arguments: audio re-encoded, cover and tags carried over. */
function convertArgs(src, dest, lossless) {
  const flac = lossless
  return [
    '-hide_banner', '-nostdin', '-y', '-i', src,
    '-map', '0:a:0', '-map', '0:v?', '-map_metadata', '0',
    ...(flac ? ['-c:a', 'flac', '-compression_level', '5'] : ['-c:a', 'aac', '-b:a', '256k']),
    '-c:v', 'copy', '-disposition:v', 'attached_pic',
    ...(flac ? [] : ['-movflags', '+faststart']),
    dest,
  ]
}

/**
 * A downloaded file Chromium can't play becomes one it can, next to it.
 * @returns the new path, or the original when nothing needed doing (or it failed).
 */
async function makePlayable(filePath, { ffmpeg } = {}) {
  const info = await probe(filePath)
  if (!info?.unplayable) return filePath
  const ext = info.lossless ? '.flac' : '.m4a'
  let dest = filePath.replace(/\.[^./\\]+$/, '') + ext
  if (dest === filePath) dest = filePath.replace(/\.[^./\\]+$/, '') + '.converted' + ext
  let temp = null
  let claimedDest = false
  const claimDestination = (preferredPath) => {
    let candidate = preferredPath
    let suffix = 1
    while (true) {
      try {
        const fd = fs.openSync(candidate, 'wx')
        fs.closeSync(fd)
        return candidate
      } catch (e) {
        if (e.code !== 'EEXIST') throw e
        const ext = path.extname(preferredPath)
        const stem = ext ? preferredPath.slice(0, -ext.length) : preferredPath
        candidate = `${stem} (${suffix++})${ext}`
      }
    }
  }
  try {
    dest = claimDestination(dest)
    claimedDest = true
    temp = `${dest}.part${ext}`
    await run(ffmpeg, convertArgs(filePath, temp, info.lossless))
    fs.renameSync(temp, dest)
    fs.unlinkSync(filePath)
    return dest
  } catch {
    if (temp) { try { fs.unlinkSync(temp) } catch {} }
    if (claimedDest) { try { fs.unlinkSync(dest) } catch {} }
    return filePath
  }
}

// ---------------------------------------------------------------- playback cache

const inFlight = new Map()

function cacheKey(filePath, stat) {
  return crypto.createHash('sha1').update(`${filePath}\u0000${stat.size}\u0000${stat.mtimeMs}`).digest('hex').slice(0, 20)
}

// Playable copies share the cache limit with moving covers (electron/cache.js).
function trimCache(dir, keep) {
  require('../cache').trim({ keep })
}

/**
 * For a library file the player couldn't open: a playable copy in the cache
 * (made once, reused), or null when the file is fine or can't be converted.
 */
const probed = new Map() // path|size|mtime -> probe result (the stream route asks on every range request)

async function playableCopy(filePath, { ffmpeg, cacheDir } = {}) {
  let stat
  try { stat = fs.statSync(filePath) } catch { return null }
  const memo = `${filePath}\u0000${stat.size}\u0000${stat.mtimeMs}`
  let info = probed.get(memo)
  if (info === undefined) {
    info = await probe(filePath)
    if (probed.size > 5000) probed.clear()
    probed.set(memo, info)
  }
  if (!info?.unplayable) return null
  ffmpeg = resolveFfmpeg(ffmpeg)
  const plans = playbackCopyPlans(info, ffmpeg)
  fs.mkdirSync(cacheDir, { recursive: true })

  // Each converter gets its own output extension and cache entry. A failed
  // afconvert attempt must not prevent the FFmpeg fallback from being tried.
  for (const plan of plans) {
    const dest = path.join(cacheDir, cacheKey(filePath, stat) + plan.extension)
    if (fs.existsSync(dest)) {
      try { const now = new Date(); fs.utimesSync(dest, now, now) } catch {}
      return dest
    }

    let job = inFlight.get(dest)
    if (!job) {
      const temp = `${dest}.part${path.extname(dest)}`
      job = (async () => {
        try {
          if (plan.converter === 'afconvert') {
            await run('/usr/bin/afconvert', afconvertArgs(filePath, temp))
          } else {
            await run(ffmpeg, convertArgs(filePath, temp, info.lossless))
          }
          fs.renameSync(temp, dest)
          trimCache(cacheDir, dest)
          return dest
        } catch {
          try { fs.unlinkSync(temp) } catch {}
          return null
        }
      })().finally(() => {
        if (inFlight.get(dest) === job) inFlight.delete(dest)
      })
      inFlight.set(dest, job)
    }

    const copy = await job
    if (copy) return copy
  }
  return null
}

module.exports = { probe, classifyCodec, makePlayable, playableCopy, convertArgs, playbackCopyPlan, playbackCopyPlans, playbackCopyFailure, afconvertArgs, resolveFfmpeg }
