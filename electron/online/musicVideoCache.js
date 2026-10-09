// Downloaded music videos. A local file is much more reliable than keeping a
// <video> element attached to YouTube's short-lived, range-sensitive URL.

const fs = require('fs')
const path = require('path')
const { once } = require('events')
const youtube = require('./youtube')
const cache = require('../cache')

const HEIGHTS = [1080, 720, 480]
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000
const STALL_TIMEOUT_MS = 60 * 1000
const VIDEO_ID = /^[\w-]{11}$/
const jobs = new Map()

function heightOf(value) {
  return HEIGHTS.includes(Number(value)) ? Number(value) : 1080
}

function extensionOf(mime) {
  return String(mime || '').toLowerCase().includes('webm') ? 'webm' : 'mp4'
}

function cachePath(cacheDir, videoId, height, ext) {
  return path.join(cacheDir, `${videoId}-${height}.${ext}`)
}

function existingFile(cacheDir, videoId, height) {
  for (const ext of ['mp4', 'webm']) {
    const file = cachePath(cacheDir, videoId, height, ext)
    try {
      if (fs.statSync(file).size > 0) {
        const now = new Date()
        fs.utimesSync(file, now, now)
        return file
      }
    } catch {}
  }
  return null
}

async function writeResponse(res, temp, { signal, timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  if (!res?.ok || !res.body?.getReader) throw new Error(`Music video download failed (HTTP ${res?.status || 0})`)
  const expected = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const output = fs.createWriteStream(temp)
  let outputError = null
  output.on('error', error => { outputError = error })
  let bytes = 0
  let timer
  let stalled
  let closed = false
  const abort = () => { try { reader.cancel() } catch {} }
  const resetStall = () => {
    clearTimeout(stalled)
    stalled = setTimeout(() => abort(), STALL_TIMEOUT_MS)
  }
  const close = () => new Promise((resolve, reject) => {
    if (closed) return resolve()
    if (outputError) return reject(outputError)
    closed = true
    output.once('error', reject)
    output.end(resolve)
  })
  try {
    if (signal?.aborted) throw new Error('Music video download cancelled')
    signal?.addEventListener?.('abort', abort, { once: true })
    timer = setTimeout(() => abort(), timeoutMs)
    resetStall()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      bytes += value.byteLength
      resetStall()
      if (!output.write(Buffer.from(value))) await once(output, 'drain')
    }
    clearTimeout(stalled)
    await close()
    if (outputError) throw outputError
    if (!bytes || (expected > 0 && bytes < expected)) throw new Error(`Music video download was incomplete (${bytes} of ${expected} bytes)`)
  } finally {
    clearTimeout(timer)
    clearTimeout(stalled)
    signal?.removeEventListener?.('abort', abort)
    if (!closed) output.destroy()
  }
}

/** Resolve and download one video, re-resolving once if its URL is refused. */
async function downloadVideo(videoId, options) {
  const { cacheDir, onProgress, fetchImpl = fetch, fetchStream = youtube.fetchStream, trim = cache.trim } = options
  const height = heightOf(options.videoHeight)
  fs.mkdirSync(cacheDir, { recursive: true })
  const key = `${cacheDir}\n${videoId}\n${height}`
  const found = existingFile(cacheDir, videoId, height)
  if (found) return found
  if (jobs.has(key)) return jobs.get(key)
  const job = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController()
      let temp = null
      try {
        onProgress?.({ stage: 'downloading', percent: null })
        const { res, mime } = await fetchStream(videoId, {
          ...options, quality: 'video', videoHeight: height, force: attempt > 0,
          signal: controller.signal, fetchImpl,
        })
        const dest = cachePath(cacheDir, videoId, height, extensionOf(mime))
        temp = `${dest}.part`
        try { fs.unlinkSync(temp) } catch {}
        await writeResponse(res, temp, {
          signal: controller.signal,
          timeoutMs: options.timeoutMs || DOWNLOAD_TIMEOUT_MS,
        })
        fs.renameSync(temp, dest)
        trim({ keep: [dest] })
        onProgress?.({ stage: 'downloaded', percent: 100 })
        return dest
      } catch (error) {
        try { if (temp) fs.unlinkSync(temp) } catch {}
        if (attempt) throw error
      } finally {
        controller.abort()
      }
    }
    return null
  })().finally(() => jobs.delete(key))
  jobs.set(key, job)
  return job
}

async function cachedVideoFile(videoId, options = {}) {
  if (!VIDEO_ID.test(String(videoId || ''))) throw new Error('Not a YouTube video id')
  const cacheDir = options.cacheDir || cache.cacheDir('musicVideo')
  if (!cacheDir) return null
  return downloadVideo(videoId, { ...options, cacheDir })
}

module.exports = { cachedVideoFile, downloadVideo, writeResponse, cachePath, heightOf }
