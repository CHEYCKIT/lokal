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

const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

let mm = null
function metadata() {
  if (mm === null) {
    try { mm = require('music-metadata') } catch { mm = false }
  }
  return mm || null
}

/** Codecs Chromium can't play, by music-metadata's codec name. */
const UNPLAYABLE = /^(?:ALAC|APE|Monkey|WavPack|TTA|WMA|Windows Media|DSD|DST|MLP|TrueHD|AC-?3|E-AC-?3|DTS)/i
const LOSSLESS = /^(?:ALAC|APE|Monkey|WavPack|TTA|DSD|DST|MLP|TrueHD|FLAC|PCM)/i

async function probe(filePath) {
  const lib = metadata()
  if (!lib) return null
  try {
    const meta = await lib.parseFile(filePath, { duration: false, skipCovers: true })
    const codec = String(meta?.format?.codec || '')
    return { codec, lossless: !!meta?.format?.lossless || LOSSLESS.test(codec), unplayable: UNPLAYABLE.test(codec) }
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

const CACHE_LIMIT_BYTES = 3 * 1024 ** 3
const inFlight = new Map()

function cacheKey(filePath, stat) {
  return crypto.createHash('sha1').update(`${filePath}\u0000${stat.size}\u0000${stat.mtimeMs}`).digest('hex').slice(0, 20)
}

function trimCache(dir) {
  let entries = []
  try {
    entries = fs.readdirSync(dir)
      .filter(f => !f.includes('.part'))
      .map(f => { const p = path.join(dir, f); const s = fs.statSync(p); return { p, size: s.size, used: s.atimeMs || s.mtimeMs } })
      .sort((a, b) => b.used - a.used)
  } catch { return }
  let total = 0
  for (const e of entries) {
    total += e.size
    if (total > CACHE_LIMIT_BYTES) { try { fs.unlinkSync(e.p) } catch {} }
  }
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
  fs.mkdirSync(cacheDir, { recursive: true })
  const dest = path.join(cacheDir, cacheKey(filePath, stat) + (info.lossless ? '.flac' : '.m4a'))
  if (fs.existsSync(dest)) {
    try { const now = new Date(); fs.utimesSync(dest, now, now) } catch {}
    return dest
  }
  if (inFlight.has(dest)) return inFlight.get(dest)
  const job = (async () => {
    const temp = `${dest}.part${path.extname(dest)}`
    try {
      await run(ffmpeg, convertArgs(filePath, temp, info.lossless))
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

module.exports = { probe, makePlayable, playableCopy, convertArgs }
