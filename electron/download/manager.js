// The download queue, shared by the desktop app and the web server (which run
// in the same process in the desktop app, so there is exactly one of these).
//
// Modelled on BitChord's DownloadService/Downloads:
//   - a real queue: a few downloads at a time (Settings → Library), the rest
//     wait their turn instead of every click starting its own yt-dlp;
//   - automatic retry, with a back-off, for failures that are worth retrying
//     (rate limits, dropped connections), never for ones that aren't (private
//     or removed videos); a manual Retry for everything else;
//   - unreadable browser cookies (Chrome/Edge on Windows) retry at once without
//     cookies;
//   - the queue is kept in SQLite: after a restart, unfinished downloads pick up
//     where they left off (yt-dlp resumes its .part files, playlists skip what
//     their archive already has) and finished ones stay listed until cleared;
//   - each file is finished (lyrics, cover, title) and indexed as it lands,
//     while yt-dlp carries on with the next one.

const { spawn } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')
const { buildArgs, resolveFormat, isYouTube } = require('./args')
const { finishFile } = require('./postprocess')
const { isCookieError, markUnreadable, COOKIE_FAILURE_MESSAGE } = require('../ipc/ytCookies')

const ACTIVE = new Set(['queued', 'downloading'])
const RETRY_DELAYS_MS = [5000, 20000]
const HISTORY_LIMIT = 150
const EMIT_INTERVAL_MS = 200

// Worth another go.
const TRANSIENT = /HTTP Error (?:429|5\d\d)|Too Many Requests|timed? ?out|Connection (?:reset|aborted|refused)|Remote end closed|Temporary failure in name resolution|getaddrinfo|ECONNRESET|ETIMEDOUT|EAI_AGAIN|IncompleteRead|Unable to download (?:webpage|API page|JSON metadata|video data)|fragment \d+ not found|The read operation timed out|SSL: /i
// Retrying won't change anything.
const PERMANENT = /Video unavailable|Private video|members[- ]only|Sign in to confirm your age|confirm you.re not a bot|copyright|not available in your country|has been removed|account .* terminated|Unsupported URL|is not a valid URL|Requested format is not available|No video formats found|Premieres in|live event will begin/i

function friendlyError(lines, fallback) {
  const text = Array.isArray(lines) ? lines.join('\n') : String(lines || '')
  if (isCookieError(text)) return COOKIE_FAILURE_MESSAGE
  if (/Requested format is not available/i.test(text)) return 'yt-dlp could not fetch the requested format. Try updating yt-dlp in Settings and retry.'
  if (/confirm you.re not a bot/i.test(text)) return 'YouTube asked to confirm you are not a bot. Turn on YouTube cookies (Firefox or a cookies.txt file) in Settings → Library.'
  if (/Sign in to confirm your age/i.test(text)) return 'This video is age-restricted. Turn on YouTube cookies in Settings → Library to download it.'
  if (/Private video/i.test(text)) return 'This video is private.'
  if (/Video unavailable|has been removed/i.test(text)) return 'This video is unavailable.'
  if (/not available in your country/i.test(text)) return 'This video is not available in your country.'
  if (/HTTP Error 429|Too Many Requests/i.test(text)) return 'YouTube is rate-limiting downloads. Try again in a while, or turn on YouTube cookies.'
  const last = (Array.isArray(lines) ? lines : text.split('\n')).filter(l => /ERROR:/.test(l)).pop()
  return last ? last.replace(/^.*?ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*[^:]*:\s*/, '').slice(0, 240) || fallback : fallback
}

function youTubeId(url) {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'youtu.be') return parsed.pathname.replace(/^\/+/, '').slice(0, 11) || null
    if (parsed.searchParams.get('v')) return parsed.searchParams.get('v')
  } catch {}
  const match = String(url || '').match(/(?:watch\?v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

function playlistIdOf(url) {
  try { return new URL(url).searchParams.get('list') || null } catch {}
  const match = String(url || '').match(/[?&]list=([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

function sourceLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host.includes('youtube') || host === 'youtu.be') return 'YouTube'
    if (host.includes('soundcloud')) return 'SoundCloud'
    if (host.includes('bandcamp')) return 'Bandcamp'
    if (host.includes('mixcloud')) return 'Mixcloud'
    return host
  } catch { return 'Source' }
}

const GENERIC_TITLE = /^(?:download|playlist \/ album|(?:youtube|soundcloud|bandcamp|mixcloud)(?: music)? (?:playlist|download|track|release|channel)(?: [\w-]{1,12})?)$/i

function terminate(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    let settled = false
    const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve() } }
    const timer = setTimeout(finish, 8000)
    proc.once('close', finish)
    proc.once('error', finish)
    try { proc.kill('SIGTERM') } catch {}
    if (process.platform === 'win32' && proc.pid) {
      try {
        const killer = spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true })
        killer.once('error', () => {})
      } catch {}
    } else {
      setTimeout(() => { try { proc.kill('SIGKILL') } catch {} }, 1500)
    }
  })
}

class DownloadManager {
  constructor() {
    this.jobs = new Map()
    this.deps = {}
    this.depPriority = {}
    this.running = 0
    this.suspended = false
    this.initialized = false
    this.looseProcs = new Set()
  }

  /** Later callers with a higher priority win per dependency (desktop over web server). */
  configure(deps = {}, priority = 0) {
    for (const [key, value] of Object.entries(deps)) {
      if (value === undefined) continue
      if ((this.depPriority[key] ?? -1) > priority) continue
      this.deps[key] = value
      this.depPriority[key] = priority
    }
    return this
  }

  db() { return this.deps.getDB() }

  settings() {
    try {
      return Object.fromEntries(this.db().prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]))
    } catch { return {} }
  }

  concurrency(settings = this.settings()) {
    const n = parseInt(settings.download_concurrency, 10)
    return Number.isFinite(n) ? Math.max(1, Math.min(6, n)) : 3
  }

  // ------------------------------------------------------------- persistence

  ensureTable() {
    this.db().exec(`CREATE TABLE IF NOT EXISTS download_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      data TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )`)
  }

  persist(job) {
    if (this.jobs.get(job.id) !== job) return // removed while its files were still being finished
    try {
      this.db().prepare('INSERT OR REPLACE INTO download_jobs (id, kind, url, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(job.id, job.kind, job.url, job.status, JSON.stringify({ ...this.snapshot(job), opts: job.opts, attempt: job.attempt, pendingIndex: job.pendingIndex || [] }), job.createdAt, Date.now())
    } catch {}
  }

  unpersist(id) {
    try { this.db().prepare('DELETE FROM download_jobs WHERE id = ?').run(id) } catch {}
  }

  /** Loads the saved queue once: finished jobs as history, unfinished ones back in line. */
  init() {
    if (this.initialized) return
    try { this.ensureTable() } catch { return } // DB not ready yet: try again on the next call
    this.initialized = true
    let rows = []
    try { rows = this.db().prepare('SELECT * FROM download_jobs ORDER BY created_at ASC').all() } catch {}
    let resumed = 0
    for (const row of rows) {
      let data = {}
      try { data = JSON.parse(row.data || '{}') } catch {}
      const job = this.makeJob(row.kind, row.url, data.opts || {}, { id: row.id, createdAt: row.created_at })
      Object.assign(job, {
        title: data.title || job.title,
        from: data.from || job.from,
        thumbnail: data.thumbnail || job.thumbnail,
        status: row.status,
        error: data.error || null,
        message: data.message || null,
        playlistId: data.playlistId ?? job.playlistId,
        pendingIndex: Array.isArray(data.pendingIndex) ? data.pendingIndex : [],
        downloadedTracks: data.downloadedTracks || [],
        indexedTracks: data.indexedTracks || [],
        lyricsCount: data.lyricsCount || 0,
        totalTracks: data.totalTracks ?? null,
        currentTrack: data.currentTrack ?? null,
        progress: data.progress || 0,
        finishedAt: data.finishedAt || null,
        output: data.output || '',
        seen: data.seen !== false,
      })
      if (ACTIVE.has(row.status)) {
        job.status = 'queued'
        job.message = 'Resuming after restart'
        job.seen = false
        resumed++
      }
      this.jobs.set(job.id, job)
    }
    this.trimHistory()
    if (resumed) setTimeout(() => this.pump(), 4000)
    setTimeout(() => this.indexLeftovers(), 6000)
  }

  /** Files a previous session downloaded but never got to add to the library. */
  async indexLeftovers() {
    for (const job of [...this.jobs.values()]) {
      if (ACTIVE.has(job.status) || !job.pendingIndex?.length || !this.deps.index) continue
      const files = job.pendingIndex.filter(fp => { try { return fs.existsSync(fp) } catch { return false } })
      job.pendingIndex = []
      for (const fp of files) await this.indexOne(job, fp)
      this.persist(job)
    }
  }

  trimHistory() {
    const finished = [...this.jobs.values()].filter(j => !ACTIVE.has(j.status)).sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt))
    for (const job of finished.slice(HISTORY_LIMIT)) { this.jobs.delete(job.id); this.unpersist(job.id) }
  }

  // ------------------------------------------------------------- jobs

  makeJob(kind, url, opts = {}, { id, createdAt } = {}) {
    const videoId = youTubeId(url)
    return {
      id: id || opts.id || `${kind === 'playlist' ? 'pl' : 'dl'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind,
      url,
      opts: { ...opts, id: undefined },
      title: opts.title || url,
      from: opts.from || (kind === 'playlist' ? `${sourceLabel(url)} playlist` : sourceLabel(url)),
      thumbnail: opts.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null),
      status: 'queued',
      progress: 0,
      speed: null,
      eta: null,
      message: 'Queued',
      song: null,
      outputLines: [],
      output: '',
      error: null,
      downloadedTracks: [],
      indexedTracks: [],
      filepaths: [],
      lyricsCount: 0,
      totalTracks: null,
      currentTrack: null,
      playlistId: kind === 'playlist' ? (opts.playlistId || playlistIdOf(url) || `pl-${Date.now()}`) : null,
      attempt: 0,
      createdAt: createdAt || Date.now(),
      startedAt: null,
      finishedAt: null,
      proc: null,
      stop: null,
      retryTimer: null,
      retryAt: null,
      withoutCookies: false,
      post: Promise.resolve(),
      lastEmit: 0,
      seen: false,
    }
  }

  snapshot(job) {
    return {
      id: job.id,
      url: job.url,
      kind: job.kind,
      title: job.title,
      from: job.from,
      thumbnail: job.thumbnail,
      status: job.status,
      progress: job.progress ?? 0,
      speed: job.speed || null,
      eta: job.eta || null,
      message: job.message || null,
      song: job.song || null,
      output: job.outputLines.length ? job.outputLines.slice(-60).join('\n') : (job.output || ''),
      error: job.error || null,
      downloadedTracks: job.downloadedTracks,
      indexedTracks: job.indexedTracks,
      lyricsCount: job.lyricsCount || 0,
      totalTracks: job.totalTracks ?? null,
      currentTrack: job.currentTrack ?? null,
      playlistId: job.playlistId ?? null,
      attempt: job.attempt || 0,
      retryAt: job.retryAt || null,
      format: job.opts?.format || null,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt || null,
      seen: !!job.seen,
    }
  }

  emit(job, force = false) {
    if (this.jobs.get(job.id) !== job) return
    const now = Date.now()
    if (!force && now - job.lastEmit < EMIT_INTERVAL_MS) {
      if (!job.emitTimer) job.emitTimer = setTimeout(() => { job.emitTimer = null; this.emit(job, true) }, EMIT_INTERVAL_MS)
      return
    }
    job.lastEmit = now
    if (job.emitTimer) { clearTimeout(job.emitTimer); job.emitTimer = null }
    try { this.deps.emit?.(this.snapshot(job)) } catch {}
  }

  update(job, patch, { persist = false, force = false } = {}) {
    Object.assign(job, patch)
    if (persist) this.persist(job)
    this.emit(job, force || persist)
  }

  list() {
    this.init()
    const rank = { downloading: 0, queued: 1 }
    return [...this.jobs.values()]
      .sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2) || (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt))
      .map(job => this.snapshot(job))
  }

  checkTools() {
    const tools = this.deps.findTools?.() || {}
    if (!tools.ytdlp) return { error: 'yt-dlp not found. Go to Settings -> External Tools to download it or set a custom path.' }
    if (this.deps.requireFfmpeg) {
      if (!tools.ffmpeg) return { error: 'ffmpeg not found. Please download it in Settings.' }
      if (!tools.ffprobe) return { error: 'ffprobe not found. Please re-download ffmpeg in Settings (it now includes ffprobe).' }
    }
    return { tools }
  }

  /** Adds a download to the queue. Returns at once; progress arrives as events. */
  enqueue(kind, url, opts = {}) {
    this.init()
    if (!url || typeof url !== 'string') return { error: 'URL is required' }
    const check = this.checkTools()
    if (check.error) return check
    const duplicate = [...this.jobs.values()].find(j => ACTIVE.has(j.status) && !j.stop && j.url === url && j.kind === kind)
    if (duplicate) return { downloadId: duplicate.id, playlistId: duplicate.playlistId, duplicate: true }
    const existing = opts.id ? this.jobs.get(opts.id) : null
    if (existing) { this.jobs.delete(existing.id); this.unpersist(existing.id) }
    const job = this.makeJob(kind, url, opts)
    this.jobs.set(job.id, job)
    this.persist(job)
    this.emit(job, true)
    if (kind === 'playlist' && (!opts.title || GENERIC_TITLE.test(String(opts.title).trim()))) this.lookUpTitle(job, check.tools.ytdlp)
    this.pump()
    return { downloadId: job.id, playlistId: job.playlistId, queued: true }
  }

  lookUpTitle(job, ytdlp) {
    const proc = spawn(ytdlp, [job.url, '--dump-single-json', '--flat-playlist', '--playlist-items', '1', '--quiet', '--no-warnings'], { windowsHide: true })
    this.looseProcs.add(proc)
    let stdout = ''
    proc.stdout.on('data', d => { stdout += d.toString() })
    const done = () => {
      this.looseProcs.delete(proc)
      try {
        const parsed = JSON.parse(stdout)
        const title = parsed?.title || parsed?.playlist_title || parsed?.uploader
        if (title && this.jobs.get(job.id) === job) {
          this.update(job, { title, from: `${sourceLabel(job.url)} playlist` }, { persist: true })
          try { this.db().prepare('UPDATE downloaded_playlists SET title = ? WHERE id = ?').run(title, job.playlistId) } catch {}
        }
      } catch {}
    }
    proc.on('close', done)
    proc.on('error', () => this.looseProcs.delete(proc))
  }

  pump() {
    if (this.suspended) return
    const limit = this.concurrency()
    const waiting = [...this.jobs.values()]
      .filter(j => j.status === 'queued' && !j.retryTimer)
      .sort((a, b) => a.createdAt - b.createdAt)
    for (const job of waiting) {
      if (this.running >= limit) break
      this.start(job)
    }
  }

  cancel(id) {
    const job = this.jobs.get(id)
    if (!job) return Promise.resolve({ success: false, status: 'missing' })
    if (job.status === 'queued') {
      if (job.retryTimer) { clearTimeout(job.retryTimer); job.retryTimer = null }
      this.update(job, { status: 'cancelled', message: 'Cancelled', finishedAt: Date.now(), retryAt: null }, { persist: true })
      this.markPlaylist(job, 'incomplete')
      return Promise.resolve({ success: true, status: 'cancelled' })
    }
    if (job.status !== 'downloading') return Promise.resolve({ success: true, status: job.status })
    // yt-dlp already finished; only the file's lyrics/indexing are left. Let it end as it really did.
    if (job.exited) return Promise.resolve({ success: true, status: 'finishing' })
    job.stop = job.kind === 'playlist' ? 'incomplete' : 'cancelled'
    this.update(job, { message: 'Stopping...' }, { force: true })
    return terminate(job.proc).then(() => ({ success: true, status: job.stop }))
  }

  async cancelAll() {
    const ids = [...this.jobs.values()].filter(j => ACTIVE.has(j.status)).map(j => j.id)
    await Promise.all(ids.map(id => this.cancel(id)))
    return { success: true, count: ids.length }
  }

  async remove(id) {
    const job = this.jobs.get(id)
    if (!job) return { success: true }
    if (ACTIVE.has(job.status)) await this.cancel(id)
    this.jobs.delete(id)
    this.unpersist(id)
    return { success: true }
  }

  clearFinished() {
    let count = 0
    for (const job of [...this.jobs.values()]) {
      if (ACTIVE.has(job.status)) continue
      this.jobs.delete(job.id)
      this.unpersist(job.id)
      count++
    }
    return { success: true, count }
  }

  retry(id) {
    const job = this.jobs.get(id)
    if (!job) return { error: 'Download not found' }
    if (ACTIVE.has(job.status)) return { downloadId: job.id }
    const check = this.checkTools()
    if (check.error) return check
    this.update(job, {
      status: 'queued', message: 'Queued', error: null, progress: 0, speed: null, eta: null,
      attempt: 0, finishedAt: null, retryAt: null, withoutCookies: false, stop: null, seen: false,
    }, { persist: true })
    this.pump()
    return { downloadId: job.id, queued: true }
  }

  /** The user has looked at the finished downloads (the sidebar indicator can go). */
  markSeen() {
    for (const job of this.jobs.values()) {
      if (!ACTIVE.has(job.status) && !job.seen) { job.seen = true; this.persist(job) }
    }
    return { success: true }
  }

  markPlaylist(job, status) {
    if (job.kind !== 'playlist' || !job.playlistId) return
    try {
      this.db().prepare('UPDATE downloaded_playlists SET status = ?, downloaded_count = ?, total_tracks = ?, last_downloaded_at = ? WHERE id = ?')
        .run(status, job.downloadedTracks.length, job.totalTracks || job.downloadedTracks.length, Date.now(), job.playlistId)
    } catch {}
  }

  // ------------------------------------------------------------- running

  start(job) {
    const check = this.checkTools()
    if (check.error) {
      this.update(job, { status: 'error', error: check.error, message: check.error, finishedAt: Date.now() }, { persist: true })
      return
    }
    const { ytdlp, ffmpeg } = check.tools
    const settings = this.settings()
    const outputDir = job.opts.outputDir || settings.music_folder || path.join(os.homedir(), 'Music')
    try { fs.ensureDirSync(outputDir) } catch {}
    const format = resolveFormat(job.opts, settings)
    job.opts.format = format.format
    let archivePath = null
    if (job.kind === 'playlist') {
      archivePath = path.join(this.deps.getStorageDir(), `archive-${job.playlistId}.txt`)
      try {
        const existing = this.db().prepare('SELECT id FROM downloaded_playlists WHERE id = ?').get(job.playlistId)
        if (existing) {
          this.db().prepare("UPDATE downloaded_playlists SET status = 'downloading', url = ?, title = COALESCE(?, title), last_downloaded_at = ? WHERE id = ?")
            .run(job.url, GENERIC_TITLE.test(job.title) ? null : job.title, Date.now(), job.playlistId)
        } else {
          this.db().prepare("INSERT INTO downloaded_playlists (id, url, title, archive_path, status, downloaded_count, last_downloaded_at) VALUES (?, ?, ?, ?, 'downloading', 0, ?)")
            .run(job.playlistId, job.url, job.title, archivePath, Date.now())
        }
      } catch {}
    }

    const { args, cookies } = buildArgs({ kind: job.kind, url: job.url, outputDir, settings, ffmpeg, format, archivePath, withoutCookies: job.withoutCookies })
    job.cookies = cookies
    job.errorLines = []
    job.outputLines.push(...cookies.notes)
    job.startedAt = Date.now()
    job.stop = null
    job.post = Promise.resolve()
    job.exited = false
    job.tracksAtStart = job.downloadedTracks.length
    job.settings = settings
    this.running++
    this.update(job, {
      status: 'downloading',
      message: job.attempt ? `Retrying (attempt ${job.attempt + 1})...` : 'Starting...',
      error: null,
      retryAt: null,
      seen: false,
    }, { persist: true })

    let proc
    try {
      proc = spawn(ytdlp, args, { windowsHide: true })
    } catch (err) {
      this.running--
      this.fail(job, err.message)
      this.pump()
      return
    }
    job.proc = proc
    const buffered = { stdout: '', stderr: '' }
    const onData = (chunk, stream) => {
      const lines = (buffered[stream] + chunk.toString()).split(/\r?\n/)
      buffered[stream] = lines.pop()
      for (const line of lines) this.onLine(job, line, stream)
    }
    proc.stdout.on('data', d => onData(d, 'stdout'))
    proc.stderr.on('data', d => onData(d, 'stderr'))
    let closed = false
    const onClose = (code, err) => {
      if (closed) return
      closed = true
      for (const stream of ['stdout', 'stderr']) if (buffered[stream].trim()) this.onLine(job, buffered[stream], stream)
      job.proc = null
      job.exited = true
      job.exitCode = code
      this.running--
      this.onExit(job, code, err).catch(() => {}).finally(() => this.pump())
    }
    proc.on('close', code => onClose(code))
    proc.on('error', err => onClose(null, err))
  }

  onLine(job, raw, stream) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) return
    job.outputLines.push(line)
    if (job.outputLines.length > 400) job.outputLines.splice(0, job.outputLines.length - 300)

    if (stream === 'stderr' || /^ERROR:|\[error\]/i.test(line)) {
      if (/error/i.test(line) && !line.includes('Deleting original file')) job.errorLines.push(line)
      this.emit(job)
      return
    }

    if (line.startsWith('filepath:')) {
      const filepath = line.slice('filepath:'.length).trim()
      if (filepath && !job.filepaths.includes(filepath)) {
        job.filepaths.push(filepath)
        this.update(job, { song: filepath, message: `Saved: ${path.basename(filepath)}` }, { force: true })
        this.afterFile(job, filepath)
      }
      return
    }

    const item = line.match(/\[download\]\s+Downloading (?:video|item)\s+(\d+)\s+of\s+(\d+)/i)
    if (item) {
      const current = parseInt(item[1], 10)
      const total = parseInt(item[2], 10)
      this.update(job, {
        currentTrack: current,
        totalTracks: total,
        progress: total > 0 ? Math.min(99, Math.round(((current - 1) / total) * 100)) : 0,
        message: `Track ${current} of ${total}`,
      }, { force: true })
      return
    }

    if (line.includes('has already been recorded in the archive')) {
      this.update(job, { message: 'Already downloaded, skipping' })
      return
    }

    const destination = line.match(/Destination:\s+(.+)/)
    if (destination) {
      this.update(job, { message: `Downloading: ${path.basename(destination[1].trim())}` })
      return
    }

    const pct = line.match(/^\[download\]\s+(\d+(?:\.\d+)?)%/)
    if (pct) {
      const raw = parseFloat(pct[1])
      const total = job.totalTracks || 0
      const current = job.currentTrack || 0
      const overall = total > 0 && current > 0 ? (((current - 1) + raw / 100) / total) * 100 : raw
      const speed = line.match(/at\s+(\S+\/s)/i)
      const eta = line.match(/ETA\s+([0-9:]+)/i)
      this.update(job, {
        progress: Math.max(0, Math.min(99, Math.round(overall))),
        speed: speed?.[1] || null,
        eta: eta?.[1] || null,
        message: total > 0 ? `Track ${current} of ${total}` : 'Downloading...',
      })
      return
    }

    const step = line.match(/^\[(ExtractAudio|Metadata|EmbedThumbnail|ThumbnailsConvertor|ffmpeg|Merger)\]/)
    if (step) {
      const labels = { ExtractAudio: 'Extracting audio', Metadata: 'Writing tags', EmbedThumbnail: 'Adding cover', ThumbnailsConvertor: 'Preparing cover', ffmpeg: 'Converting', Merger: 'Merging' }
      this.update(job, { message: `${labels[step[1]] || step[1]}...` })
    }
  }

  /** Finishes and indexes one file, in the background, one at a time per job. */
  afterFile(job, filepath) {
    job.post = job.post.then(async () => {
      let finalPath = filepath
      try {
        this.update(job, { message: `Adding lyrics: ${path.basename(filepath)}` })
        const done = await finishFile(filepath, { db: this.db(), settings: job.settings || {}, url: job.url })
        finalPath = done.filePath
        const name = path.basename(finalPath)
        if (!job.downloadedTracks.includes(name)) job.downloadedTracks.push(name)
        if (done.lyrics) job.lyricsCount = (job.lyricsCount || 0) + 1
        job.outputLines.push(done.lyrics
          ? `[Lokal] Lyrics added (${done.lyrics === 'syllable' ? 'word by word' : done.lyrics === 'line' ? 'line by line' : 'plain text'}, ${done.lyricsSource}): ${name}`
          : `[Lokal] No lyrics found for ${name}`)
      } catch {
        const name = path.basename(filepath)
        if (!job.downloadedTracks.includes(name)) job.downloadedTracks.push(name)
      }
      const index = this.deps.index
      if (index && (job.settings?.index_while_downloading === '1' || job.kind === 'single')) {
        await this.indexOne(job, finalPath)
      } else {
        job.pendingIndex = [...(job.pendingIndex || []), finalPath]
      }
      this.update(job, { song: finalPath }, { persist: true })
    })
  }

  async indexOne(job, filepath) {
    const index = this.deps.index
    if (!index) return
    try {
      const videoId = job.kind === 'single' ? youTubeId(job.url) : null
      const result = await index(filepath, { thumbnailUrl: videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : undefined })
      if (result?.id) {
        job.indexedTracks.push({ filepath, id: result.id, title: path.basename(filepath, path.extname(filepath)) })
        this.update(job, { message: `Added to library: ${path.basename(filepath)}` })
        try { this.deps.onLibraryUpdated?.(result) } catch {}
      }
    } catch {}
  }

  async onExit(job, code, err) {
    await job.post.catch(() => {})
    for (const fp of job.pendingIndex || []) await this.indexOne(job, fp)
    job.pendingIndex = []
    await this.cleanup(job).catch(() => {})

    if (this.jobs.get(job.id) !== job) return

    if (job.stop === 'suspend') {
      this.update(job, { status: 'queued', message: 'Paused while yt-dlp updates', speed: null, eta: null }, { persist: true })
      return
    }
    if (job.stop) {
      const status = job.stop
      this.markPlaylist(job, status)
      this.update(job, {
        status,
        message: status === 'incomplete' ? 'Stopped before finishing' : 'Cancelled',
        speed: null, eta: null, finishedAt: Date.now(),
      }, { persist: true })
      return
    }

    const partial = job.kind === 'playlist' && job.downloadedTracks.length > (job.tracksAtStart || 0)
    if (code === 0 && !err) {
      this.markPlaylist(job, 'completed')
      const n = job.downloadedTracks.length
      const lyrics = job.lyricsCount ? ` · lyrics for ${job.lyricsCount}` : ''
      this.update(job, {
        status: 'done',
        progress: 100,
        speed: null, eta: null,
        message: job.kind === 'playlist' ? `${n} track${n === 1 ? '' : 's'} downloaded${lyrics}` : `Downloaded${lyrics}`,
        currentTrack: job.totalTracks || n || null,
        totalTracks: job.totalTracks || n || null,
        finishedAt: Date.now(),
      }, { persist: true })
      this.trimHistory()
      return
    }

    const lines = job.errorLines.length ? job.errorLines : job.outputLines
    // Unreadable browser cookies: straight back in line without them.
    if (!err && job.cookies?.usedBrowser && !partial && isCookieError(lines)) {
      job.outputLines.push(markUnreadable(job.cookies.usedBrowser))
      job.withoutCookies = true
      this.update(job, { status: 'queued', message: 'Retrying without cookies...' }, { persist: true })
      return
    }

    // A playlist where some tracks failed but others landed: done, with a note.
    if (job.kind === 'playlist' && partial && !err) {
      this.markPlaylist(job, 'completed')
      const failed = job.errorLines.filter(l => /ERROR:/.test(l)).length
      this.update(job, {
        status: 'done',
        progress: 100,
        speed: null, eta: null,
        message: `${job.downloadedTracks.length} downloaded${failed ? `, ${failed} unavailable` : ''}`,
        finishedAt: Date.now(),
      }, { persist: true })
      return
    }

    const text = lines.join('\n')
    if (!err && job.attempt < RETRY_DELAYS_MS.length && TRANSIENT.test(text) && !PERMANENT.test(text)) {
      const delay = RETRY_DELAYS_MS[job.attempt]
      job.attempt++
      job.retryAt = Date.now() + delay
      this.update(job, { status: 'queued', message: `Retrying in ${Math.round(delay / 1000)}s...`, speed: null, eta: null }, { persist: true })
      job.retryTimer = setTimeout(() => { job.retryTimer = null; job.retryAt = null; this.pump() }, delay)
      return
    }

    this.fail(job, err ? err.message : friendlyError(lines, code === null ? 'Download stopped' : `Download failed (exit ${code})`))
  }

  fail(job, message) {
    this.markPlaylist(job, 'failed')
    this.update(job, { status: 'error', error: message, message, speed: null, eta: null, finishedAt: Date.now() }, { persist: true })
    this.trimHistory()
  }

  /** Thumbnails and partial files yt-dlp leaves next to finished tracks. */
  async cleanup(job) {
    const junk = new Set(['.webp', '.ytdl', '.temp', '.mhtml', '.info.json'])
    for (const fp of job.filepaths) {
      const dir = path.dirname(fp)
      const base = path.basename(fp, path.extname(fp))
      let siblings = []
      try { siblings = fs.readdirSync(dir) } catch { continue }
      for (const file of siblings) {
        if (!file.startsWith(base + '.')) continue
        const ext = path.extname(file).toLowerCase()
        const full = path.join(dir, file)
        if (junk.has(ext) || file.endsWith('.jpg.part') || (ext === '.jpg' && (() => { try { return fs.statSync(full).size < 51200 } catch { return false } })())) {
          try { fs.unlinkSync(full) } catch {}
        }
      }
    }
  }

  // ------------------------------------------------------------- lifecycle

  /** Stops running downloads so yt-dlp can be replaced; they go back in line. */
  async suspend() {
    this.suspended = true
    const running = [...this.jobs.values()].filter(j => j.status === 'downloading' && !j.exited)
    for (const job of running) job.stop = 'suspend'
    await Promise.all(running.map(j => terminate(j.proc)))
    await Promise.all([...this.looseProcs].map(p => terminate(p)))
    return { success: true, count: running.length, ids: running.map(j => j.id) }
  }

  resume() {
    if (!this.suspended) return
    this.suspended = false
    this.pump()
  }

  /** App quitting: stop everything, leave it queued so it resumes next launch. */
  shutdown() {
    this.suspended = true
    for (const job of this.jobs.values()) {
      if (job.retryTimer) { clearTimeout(job.retryTimer); job.retryTimer = null }
      if (job.status === 'downloading') {
        // Files that landed but aren't in the library yet get indexed on the next launch.
        const indexed = new Set(job.indexedTracks.map(t => t.filepath))
        job.pendingIndex = [...new Set([...(job.pendingIndex || []), ...job.filepaths])].filter(fp => !indexed.has(fp))
      }
      if (job.status === 'downloading' && job.exited && job.exitCode === 0) {
        // yt-dlp finished; only lyrics/indexing were left. Don't download it again.
        job.status = 'done'
        job.message = 'Downloaded'
        job.finishedAt = Date.now()
        this.persist(job)
      } else if (job.status === 'downloading' && !job.exited) {
        job.stop = 'suspend'
        this.markPlaylist(job, 'incomplete')
        job.status = 'queued'
        job.message = 'Resuming after restart'
        this.persist(job)
        terminate(job.proc)
      }
    }
    for (const proc of this.looseProcs) terminate(proc)
  }

  hasPlaylistRunning(playlistId, url) {
    return [...this.jobs.values()].find(j => ACTIVE.has(j.status) && j.kind === 'playlist' && (j.playlistId === playlistId || (url && j.url === url))) || null
  }
}

let instance = null
function getDownloadManager() {
  if (!instance) instance = new DownloadManager()
  return instance
}

module.exports = { getDownloadManager, DownloadManager, friendlyError, youTubeId, playlistIdOf, TRANSIENT, PERMANENT }
