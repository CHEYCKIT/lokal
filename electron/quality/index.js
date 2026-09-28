// Audio quality of the library: what each file really is (codec, lossless,
// sample rate, bit depth), its ISRC, and a spectrum check that spots lossless
// files made from a lossy source (a "fake FLAC": an MP3 or AAC converted to
// FLAC keeps the lossy encoder's high-frequency cut-off).
//
// Shared by the desktop app (IPC, electron/ipc/quality.js) and the web server
// (server/routes/quality.js); nothing here needs Electron.
//
// Tiers, best first:
//   hires     lossless above CD quality (more than 16 bit or 48 kHz)
//   lossless  lossless at CD quality
//   high      lossy at a high bitrate (MP3/AAC 256 kbps+, Opus/Vorbis 160 kbps+)
//   low       lossy below that
//   unknown   not read yet (or unreadable)
// plus "suspect": a lossless file whose spectrum says it came from a lossy one.

const fs = require('fs')
const { spawn, execFileSync } = require('child_process')

const LOSSLESS_CODEC = /^(?:ALAC|APE|Monkey|WavPack|TTA|DSD|DST|MLP|TrueHD|FLAC|PCM|WAVE?|AIFF)/i
const OPUS_LIKE = /^(?:opus|vorbis)/i

// ---------------------------------------------------------------- reading

/** A clean ISRC (CC-XXX-YY-NNNNN without dashes, upper case), or null. */
function normalizeIsrc(value) {
  const raw = Array.isArray(value) ? value[0] : value
  const isrc = String(raw || '').replace(/[\s-]/g, '').toUpperCase()
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) ? isrc : null
}

/** The quality fields of a file, from music-metadata's result. */
function qualityFields(meta) {
  const format = meta?.format || {}
  const codec = String(format.codec || format.container || '').trim() || null
  const lossless = format.lossless === true || LOSSLESS_CODEC.test(codec || '')
  return {
    codec,
    lossless: codec ? (lossless ? 1 : 0) : null,
    sample_rate: Number(format.sampleRate) > 0 ? Math.round(format.sampleRate) : null,
    bit_depth: lossless && Number(format.bitsPerSample) > 0 ? Math.round(format.bitsPerSample) : null,
    isrc: normalizeIsrc(meta?.common?.isrc),
  }
}

const COLUMNS = [
  ['codec', 'TEXT'],
  ['lossless', 'INTEGER'],
  ['sample_rate', 'INTEGER'],
  ['bit_depth', 'INTEGER'],
  ['isrc', 'TEXT'],
  ['quality_read_at', 'INTEGER'],
  ['spectral_cutoff', 'INTEGER'],
  ['spectral_verdict', 'TEXT'],
  ['spectral_checked_at', 'INTEGER'],
]

/** Add the quality columns to tracks (once). */
function ensureColumns(db) {
  const have = new Set(db.prepare('PRAGMA table_info(tracks)').all().map(c => c.name))
  for (const [name, type] of COLUMNS) {
    if (!have.has(name)) { try { db.exec(`ALTER TABLE tracks ADD COLUMN ${name} ${type}`) } catch {} }
  }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_tracks_isrc ON tracks(isrc)') } catch {}
}

/**
 * Save a file's quality fields on its track. `fileChanged`: the file is new
 * or was modified, so an earlier spectrum check no longer applies.
 */
function saveFields(db, trackId, fields, { fileChanged = false } = {}) {
  ensureColumns(db)
  db.prepare(`UPDATE tracks SET codec = @codec, lossless = @lossless, sample_rate = @sample_rate, bit_depth = @bit_depth,
    isrc = COALESCE(@isrc, isrc), quality_read_at = @at${fileChanged ? ', spectral_verdict = NULL, spectral_cutoff = NULL, spectral_checked_at = NULL' : ''} WHERE id = @id`)
    .run({ codec: null, lossless: null, sample_rate: null, bit_depth: null, isrc: null, ...fields, id: trackId, at: Date.now() })
}

// ---------------------------------------------------------------- tiers

/** Tier of a track row (see the top of this file). */
function tierOf(track) {
  if (!track || track.lossless === null || track.lossless === undefined) return 'unknown'
  if (Number(track.lossless) === 1) {
    return Number(track.bit_depth) > 16 || Number(track.sample_rate) > 48000 ? 'hires' : 'lossless'
  }
  const kbps = Number(track.bitrate) || 0
  if (!kbps) return 'low'
  return kbps >= (OPUS_LIKE.test(String(track.codec || '')) ? 160 : 256) ? 'high' : 'low'
}

/** SQL for a tier (keeps listing and counting in the database). */
const TIER_SQL = {
  hires: "lossless = 1 AND (bit_depth > 16 OR sample_rate > 48000)",
  lossless: "lossless = 1 AND NOT (IFNULL(bit_depth, 0) > 16 OR IFNULL(sample_rate, 0) > 48000)",
  high: "lossless = 0 AND bitrate >= (CASE WHEN LOWER(IFNULL(codec, '')) LIKE 'opus%' OR LOWER(IFNULL(codec, '')) LIKE 'vorbis%' THEN 160 ELSE 256 END)",
  low: "lossless = 0 AND (bitrate IS NULL OR bitrate < (CASE WHEN LOWER(IFNULL(codec, '')) LIKE 'opus%' OR LOWER(IFNULL(codec, '')) LIKE 'vorbis%' THEN 160 ELSE 256 END))",
  unknown: 'lossless IS NULL',
  // Only a confirmed lossy source: "likely-lossy" (a cut-off some real
  // masters have too) is shown on the track but not counted against it.
  suspect: "lossless = 1 AND spectral_verdict = 'lossy'",
  // What's worth replacing: lossy files and suspect lossless ones.
  upgradable: "(lossless = 0) OR (lossless = 1 AND spectral_verdict = 'lossy')",
}

const REAL_FILE = "file_path NOT LIKE 'ghost://%'"

/** Count of tracks per tier, and how many lossless files are still unchecked. */
function summary(db) {
  ensureColumns(db)
  const count = (where) => db.prepare(`SELECT COUNT(*) AS n FROM tracks WHERE ${REAL_FILE} AND (${where})`).get().n
  const tiers = {}
  for (const tier of Object.keys(TIER_SQL)) tiers[tier] = count(TIER_SQL[tier])
  return {
    total: db.prepare(`SELECT COUNT(*) AS n FROM tracks WHERE ${REAL_FILE}`).get().n,
    tiers,
    unchecked: count('lossless = 1 AND spectral_checked_at IS NULL'),
    withIsrc: count('isrc IS NOT NULL'),
  }
}

/** Tracks of a tier, worst first within it (lowest bitrate, then most played). */
function list(db, { tier = 'upgradable', limit = 200, offset = 0 } = {}) {
  ensureColumns(db)
  const where = TIER_SQL[tier] || TIER_SQL.upgradable
  const rows = db.prepare(`SELECT * FROM tracks WHERE ${REAL_FILE} AND (${where})
    ORDER BY lossless ASC, IFNULL(bitrate, 0) ASC, play_count DESC, artist, title LIMIT ? OFFSET ?`)
    .all(Math.min(Math.max(Number(limit) || 200, 1), 1000), Math.max(Number(offset) || 0, 0))
  return rows.map(row => ({ ...row, tier: tierOf(row) }))
}

// ---------------------------------------------------------------- jobs

// One background job at a time (reading tags, or checking spectra), with a
// status the UI polls. Cancelling stops it after the current file.
let job = null

function status() {
  if (!job) return { running: false }
  const { kind, total, done, failed, startedAt, finishedAt, cancelled } = job
  return { running: !finishedAt, kind, total, done, failed, startedAt, finishedAt, cancelled: !!cancelled }
}

function cancel() {
  if (job && !job.finishedAt) job.cancelled = true
  return status()
}

function startJob(kind, items, worker, { concurrency = 1 } = {}) {
  if (job && !job.finishedAt) return { error: 'Already busy with the library, try again when it finishes.', ...status() }
  job = { kind, total: items.length, done: 0, failed: 0, startedAt: Date.now(), finishedAt: null, cancelled: false }
  const current = job
  let next = 0
  const lane = async () => {
    while (!current.cancelled && next < items.length) {
      const item = items[next++]
      try { if ((await worker(item)) === false) current.failed++ } catch { current.failed++ }
      current.done++
    }
  }
  Promise.all(Array.from({ length: Math.max(1, concurrency) }, lane)).finally(() => { current.finishedAt = Date.now() })
  return status()
}

let mmLib = null
function musicMetadata() {
  if (mmLib === null) { try { mmLib = require('music-metadata') } catch { mmLib = false } }
  return mmLib || null
}

/** Read the quality fields of `filePath` (tags and headers only: fast). */
async function readFile(filePath) {
  const mm = musicMetadata()
  if (!mm) return null
  const meta = await mm.parseFile(filePath, { duration: false, skipCovers: true })
  return qualityFields(meta)
}

/**
 * Read codec / sample rate / bit depth / ISRC for tracks indexed before
 * Lokal kept them (or `all` to re-read every file).
 */
function startReading(db, { all = false } = {}) {
  ensureColumns(db)
  const rows = db.prepare(`SELECT id, file_path FROM tracks WHERE ${REAL_FILE}${all ? '' : ' AND quality_read_at IS NULL'}`).all()
  return startJob('read', rows, async (row) => {
    if (!fs.existsSync(row.file_path)) return false
    const fields = await readFile(row.file_path)
    if (!fields) return false
    saveFields(db, row.id, fields)
    return true
  })
}

// ---------------------------------------------------------------- spectrum

// Lossy encoders throw away what's above a cut-off that depends on the
// bitrate (MP3 128 kbps: ~16 kHz, 192: ~19 kHz, 320: ~20 kHz; AAC 128:
// ~17 kHz). Decoded and saved as FLAC, that shelf stays: above it there is
// next to nothing, while a real CD-quality master has content up to ~22 kHz.
// So: measure the energy in bands from 15 kHz up, and find where it falls
// off a cliff.
const BANDS = [
  [1000, 15000], // reference: where the music is
  [15000, 16000],
  [16000, 17000],
  [17000, 18000],
  [18000, 19000],
  [19000, 19800],
  [19800, 20500],
  [20500, 21500],
]
const SAMPLE_SECONDS = 12
const CLIFF_DB = 35 // this far below the band under it...
const FLOOR_DB = -90 // ...or below this (dBFS RMS): nothing there

let ffmpegPath = null
/**
 * ffmpeg for the web server: the one Settings points at, else the one on
 * PATH. (The desktop app passes its own, found like everywhere else in the
 * app: the one installed from Settings → Tools, bundled, custom or on PATH.)
 */
function findFfmpeg(db) {
  try {
    const custom = db?.prepare("SELECT value FROM settings WHERE key = 'custom_ffmpeg_path'").get()?.value
    if (custom && fs.existsSync(custom)) return custom
  } catch {}
  if (ffmpegPath) return ffmpegPath
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  // Only a hit is remembered: installing ffmpeg later works without a restart.
  try { execFileSync(name, ['-version'], { stdio: 'ignore', windowsHide: true }); ffmpegPath = name } catch {}
  return ffmpegPath
}

/** Band-pass one band with an FFT (steep, so what's below doesn't leak in), then measure its RMS. */
function bandChain(input, [lo, hi]) {
  const keep = `between(b*sr/(2*nb)\\,${lo}\\,${hi})`
  return `${input}afftfilt=real='re*${keep}':imag='im*${keep}':win_size=4096,astats=metadata=0:measure_perchannel=none:measure_overall=RMS_level,anullsink`
}

/** RMS level (dBFS) of each band of `filePath`, in BANDS order. */
function measureBands(ffmpeg, filePath, { start = 0, timeoutMs = 60000 } = {}) {
  const bands = BANDS
  const labels = bands.map((_, i) => `[b${i}]`).join('')
  const graph = `[0:a]aformat=channel_layouts=mono,asplit=${bands.length + 1}${labels}[out];${bands.map((band, i) => bandChain(`[b${i}]`, band)).join(';')}`
  const args = ['-hide_banner', '-nostats', '-ss', String(Math.max(0, start)), '-t', String(SAMPLE_SECONDS), '-i', filePath, '-filter_complex', graph, '-map', '[out]', '-f', 'null', '-']
  return new Promise((resolve, reject) => {
    let proc
    try { proc = spawn(ffmpeg, args, { windowsHide: true }) } catch (e) { reject(e); return }
    let err = ''
    const timer = setTimeout(() => { try { proc.kill('SIGKILL') } catch {} }, timeoutMs)
    proc.stderr.on('data', d => { err = (err + d.toString()).slice(-64 * 1024) })
    proc.on('error', e => { clearTimeout(timer); reject(e) })
    proc.on('close', (code) => {
      clearTimeout(timer)
      // Each astats instance reports "RMS level dB" under its own name; the
      // instances are numbered in the order the chains were written.
      const found = []
      const re = /\[Parsed_astats_(\d+)[^\]]*\][^\n]*\n(?:[^\n]*\n)*?[^\n]*RMS level dB: (-?[\d.]+|-inf)/g
      for (const m of err.matchAll(re)) found.push([Number(m[1]), m[2] === '-inf' ? -200 : Number(m[2])])
      if (code !== 0 || found.length !== bands.length) {
        reject(new Error(`ffmpeg could not analyse the file${code ? ` (exit ${code})` : ''}`))
        return
      }
      resolve(found.sort((a, b) => a[0] - b[0]).map(([, level]) => level))
    })
  })
}

/**
 * Verdict from band levels:
 *   ok            content all the way up (or a cut-off only lossless masters have)
 *   likely-lossy  cut-off at 19-20.5 kHz: MP3 256-320 kbps... or a master that stops there
 *   lossy         cut-off below 19 kHz: an MP3/AAC at 192 kbps or less
 *   inconclusive  too quiet, or no high frequencies to judge by
 * with `cutoff` (Hz) where the energy stops, when there is one.
 */
function verdictFromLevels(levels) {
  const [reference, ...high] = levels
  if (reference < -70) return { verdict: 'inconclusive', cutoff: null, reason: 'Too quiet to judge' }
  if (high.every(level => level <= FLOOR_DB)) return { verdict: 'lossy', cutoff: 15000, reason: 'Nothing above 15 kHz, like a low-bitrate MP3/AAC' }
  if (high[0] < reference - 45) return { verdict: 'inconclusive', cutoff: null, reason: 'Hardly any high frequencies in this recording' }
  let cutoff = null
  for (let i = 1; i < high.length; i++) {
    const empty = high[i] <= FLOOR_DB || high[i] < high[i - 1] - CLIFF_DB
    // Real roll-offs are gradual; a lossy encoder's is a wall, and nothing
    // comes back above it.
    if (empty && high.slice(i).every(level => level <= Math.max(FLOOR_DB, high[i - 1] - CLIFF_DB))) {
      cutoff = BANDS[i + 1][0]
      break
    }
  }
  if (cutoff !== null && cutoff <= 19000) return { verdict: 'lossy', cutoff, reason: `Nothing above ${cutoff / 1000} kHz, like an MP3/AAC at 192 kbps or less` }
  if (cutoff !== null) return { verdict: 'likely-lossy', cutoff, reason: `Nothing above ${cutoff / 1000} kHz, like a 256-320 kbps MP3 (some real masters stop there too)` }
  return { verdict: 'ok', cutoff: null, reason: 'Full spectrum, no sign of a lossy source' }
}

/** Check one lossless file's spectrum. */
async function spectralCheck(filePath, { ffmpeg, duration, sampleRate } = {}) {
  if (!ffmpeg) throw new Error('ffmpeg is needed to check files (Settings → Tools).')
  if (Number(sampleRate) && Number(sampleRate) < 44100) return { verdict: 'inconclusive', cutoff: null, reason: 'Sample rate too low to judge' }
  const d = Number(duration) || 0
  // A stretch from the middle: intros and fade-outs are often quiet.
  const start = d > SAMPLE_SECONDS * 2 ? Math.floor(d / 2 - SAMPLE_SECONDS / 2) : 0
  // (Hi-res files are judged on the same bands: an MP3 source shows the
  // same wall. Telling a CD upsampled to 96 kHz from a real hi-res master
  // isn't reliable enough from the spectrum alone, so it isn't claimed.)
  const levels = await measureBands(ffmpeg, filePath, { start })
  return verdictFromLevels(levels)
}

/** Save a spectrum result on a track. */
function saveVerdict(db, trackId, result) {
  db.prepare('UPDATE tracks SET spectral_verdict = ?, spectral_cutoff = ?, spectral_checked_at = ? WHERE id = ?')
    .run(result.verdict, result.cutoff, Date.now(), trackId)
}

/** Check lossless tracks: the given ids, or every one not checked yet. */
function startChecking(db, { ids = null, recheck = false, ffmpeg: givenFfmpeg = null } = {}) {
  ensureColumns(db)
  const ffmpeg = givenFfmpeg || findFfmpeg(db)
  if (!ffmpeg) return { error: 'ffmpeg is needed to check files. Install it in Settings → Tools.' }
  let rows
  if (Array.isArray(ids) && ids.length) {
    const wanted = ids.slice(0, 5000).map(String)
    rows = db.prepare(`SELECT id, file_path, duration, sample_rate FROM tracks WHERE ${REAL_FILE} AND lossless = 1 AND id IN (${wanted.map(() => '?').join(',')})`).all(...wanted)
  } else {
    rows = db.prepare(`SELECT id, file_path, duration, sample_rate FROM tracks WHERE ${REAL_FILE} AND lossless = 1${recheck ? '' : ' AND spectral_checked_at IS NULL'}`).all()
  }
  if (!rows.length) return { error: 'No lossless files to check.' }
  return startJob('check', rows, async (row) => {
    if (!fs.existsSync(row.file_path)) return false
    const result = await spectralCheck(row.file_path, { ffmpeg, duration: row.duration, sampleRate: row.sample_rate })
    saveVerdict(db, row.id, result)
    return true
  }, { concurrency: 2 })
}

/** Check one track now and return the result (for the track's menu). */
async function checkOne(db, trackId, { ffmpeg = null } = {}) {
  ensureColumns(db)
  const row = db.prepare(`SELECT id, file_path, duration, sample_rate, lossless FROM tracks WHERE id = ? AND ${REAL_FILE}`).get(String(trackId || ''))
  if (!row) return { error: 'Track not found' }
  if (Number(row.lossless) !== 1) return { error: 'Only lossless files can be checked: a lossy file is lossy already.' }
  if (!fs.existsSync(row.file_path)) return { error: 'The file is missing' }
  const result = await spectralCheck(row.file_path, { ffmpeg: ffmpeg || findFfmpeg(db), duration: row.duration, sampleRate: row.sample_rate })
  saveVerdict(db, row.id, result)
  return result
}

module.exports = {
  normalizeIsrc, qualityFields, ensureColumns, saveFields, readFile,
  tierOf, summary, list, status, cancel, startReading,
  verdictFromLevels, measureBands, spectralCheck, startChecking, checkOne, findFfmpeg, BANDS,
}
