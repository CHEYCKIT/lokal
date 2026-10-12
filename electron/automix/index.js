// AutoMix's song analyses (analysis.js): a song's file, or an online song's
// stream, is decoded by ffmpeg to mono 11 kHz, analysed in a worker thread
// (a few tens of milliseconds a song), and kept in the database, so each
// song is analysed once. The player asks for the playing song and the next
// one, ahead of the transition (src/audio/automix.js plans it).
//
// A library song with no tempo or key of its own (none imported) gets the
// ones found here, for Flow's moods.

const { spawn } = require('child_process')
const path = require('path')
const { RATE, VERSION } = require('./analysis')

const MAX_SECONDS = 20 * 60 // longer (a DJ set, an album in one file): not analysed
const DECODE_TIMEOUT_MS = 90 * 1000

let worker = null
let nextJob = 0
const waiting = new Map() // job id -> { resolve, reject }
const running = new Map() // cache key -> Promise<analysis | null>

function analyzer() {
  if (worker) return worker
  const { Worker } = require('worker_threads')
  worker = new Worker(path.join(__dirname, 'worker.js'))
  worker.unref()
  worker.on('message', ({ id, result, error }) => {
    const job = waiting.get(id)
    if (!job) return
    waiting.delete(id)
    if (error) job.reject(new Error(error))
    else job.resolve(result)
  })
  // Crashed or exited (killed for memory, say): the analyses waiting on it fail
  // rather than wait forever, and the next one starts a new worker.
  const self = worker
  const fail = error => {
    for (const job of waiting.values()) job.reject(error)
    waiting.clear()
    if (worker === self) worker = null
  }
  worker.on('error', fail)
  worker.on('exit', code => fail(new Error(`The analysis worker stopped (${code})`)))
  return worker
}

function analyzePcm(buffer) {
  const id = ++nextJob
  const pcm = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    analyzer().postMessage({ id, pcm, rate: RATE }, [pcm])
  })
}

/** Mono float PCM at RATE from a file or URL (with request headers for a stream). */
function decode(ffmpeg, input, headers = null) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-nostdin']
    if (headers && Object.keys(headers).length) args.push('-headers', Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join(''))
    // A second past the limit, so a longer one shows as longer (and isn't analysed).
    args.push('-i', input, '-vn', '-t', String(MAX_SECONDS + 1), '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1')
    const child = spawn(ffmpeg, args, { windowsHide: true })
    const chunks = []
    let size = 0
    let errors = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Decoding took too long')) }, DECODE_TIMEOUT_MS)
    child.stdout.on('data', chunk => { chunks.push(chunk); size += chunk.length })
    child.stderr.on('data', chunk => { if (errors.length < 2000) errors += chunk })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => {
      clearTimeout(timer)
      // Failed part way: what came out is part of the song, not the song.
      if (code !== 0) { reject(new Error(errors.trim().split('\n').pop() || `ffmpeg exited with ${code}`)); return }
      resolve(Buffer.concat(chunks, size - (size % 4)))
    })
  })
}

function ensureTable(db) {
  db.prepare('CREATE TABLE IF NOT EXISTS track_analysis (key TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL, analyzed_at INTEGER DEFAULT (unixepoch()))').run()
}

/**
 * The analysis for a song: from the database, or decoded and analysed now.
 * `source()` gives { file } or { url, headers } to decode. Null when it can't be.
 */
function analysisFor({ db, key, source, ffmpeg, trackId = null, log = () => {} }) {
  if (!key) return Promise.resolve(null)
  ensureTable(db)
  const row = db.prepare('SELECT version, data FROM track_analysis WHERE key = ?').get(key)
  if (row && row.version === VERSION) {
    try {
      const data = JSON.parse(row.data)
      return Promise.resolve(data?.tooLong ? null : data)
    } catch {}
  }
  if (running.has(key)) return running.get(key)
  const job = (async () => {
    try {
      const where = await source()
      if (!where?.file && !where?.url) return null
      const binary = ffmpeg()
      if (!binary) return null
      const started = Date.now()
      const pcm = await decode(binary, where.file || where.url, where.headers)
      if (pcm.length < RATE * 4 * 5) return null // under 5 s: nothing to plan with
      if (pcm.length > RATE * 4 * MAX_SECONDS) {
        // Longer than the limit: its end was never heard, so it isn't planned
        // from (remembered, so it isn't decoded again each time).
        db.prepare('INSERT OR REPLACE INTO track_analysis (key, version, data) VALUES (?, ?, ?)').run(key, VERSION, JSON.stringify({ tooLong: true }))
        log(`automix: ${key} is over ${MAX_SECONDS / 60} minutes, not analysed`)
        return null
      }
      const result = await analyzePcm(pcm)
      db.prepare('INSERT OR REPLACE INTO track_analysis (key, version, data) VALUES (?, ?, ?)').run(key, VERSION, JSON.stringify(result))
      // A library song's tempo and key, when it has none of its own (Flow's moods use them).
      if (trackId) {
        try {
          db.prepare('UPDATE tracks SET tempo = COALESCE(tempo, ?), track_key = COALESCE(track_key, ?), mode = COALESCE(mode, ?) WHERE id = ?')
            .run(result.bpm, result.key, result.mode, trackId)
        } catch {}
      }
      log(`automix: analysed ${key} in ${Date.now() - started} ms (${result.bpm} BPM, ${result.camelot}, ends ${result.audibleEnd}s of ${result.duration}s)`)
      return result
    } catch (error) {
      log(`automix: couldn't analyse ${key}: ${error.message}`)
      return null
    } finally {
      running.delete(key)
    }
  })()
  running.set(key, job)
  return job
}

module.exports = { analysisFor, decode, analyzePcm }
