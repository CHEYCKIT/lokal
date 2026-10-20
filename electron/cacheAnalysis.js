// Cache Analysis page: what takes space in the app's folder (%APPDATA%\lokal-music
// on Windows) -- every file under it, sorted into sections: the library database
// (with its tables), covers, Lokal's own caches, tools, Chromium's caches, the
// embedded sign-in sessions, logs and app state. Anything not recognised is still
// counted, under "Other", so the total matches what Explorer shows.

const fs = require('fs')
const path = require('path')

const CLUSTER = 4096

// Chromium's own folders and files in userData, by what they're for.
const BROWSER_CACHE = new Set(['Cache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'ShaderCache', 'DawnGraphiteCache',
  'DawnWebGPUCache', 'GPUPersistentCache', 'Shared Dictionary', 'VideoDecodeStats', 'blob_storage', 'Service Worker'])
const APP_STATE = new Set(['Local Storage', 'Session Storage', 'WebStorage', 'IndexedDB', 'Preferences', 'Local State',
  'Network', 'DIPS', 'DIPS-wal', 'shared_proto_db', 'declarative_performance_observer.db',
  'declarative_performance_observer.db-journal', 'lockfile', 'window-state.json', 'window-background.txt',
  'youtube-signin', 'Cookies', 'Cookies-journal', 'TransportSecurity', 'Trust Tokens', 'Trust Tokens-journal'])
// data/ folders (see electron/cache.js and electron/ipc/db.js).
const DATA_DIRS = {
  'motion-covers': 'motionCovers', 'playback-cache': 'playbackCache', 'music-video-cache': 'musicVideoCache',
  'cast-cache': 'castCache', spotiflac: 'addonCache', lyrics: 'lyricsFiles', avatars: 'avatars', plugins: 'plugins',
}

const onDisk = size => Math.ceil(size / CLUSTER) * CLUSTER

/** { size, disk, files, dirs, list? } of everything under `p` (a file or a folder). */
async function measure(p, { keepFiles = false } = {}) {
  const out = { size: 0, disk: 0, files: 0, dirs: 0 }
  if (keepFiles) out.list = []
  const walk = async (cur) => {
    let st
    try { st = await fs.promises.lstat(cur) } catch { return }
    if (st.isSymbolicLink()) return
    if (st.isFile()) {
      out.size += st.size; out.disk += onDisk(st.size); out.files++
      if (keepFiles) out.list.push({ path: cur, size: st.size })
      return
    }
    if (!st.isDirectory()) return
    out.dirs++
    let names = []
    try { names = await fs.promises.readdir(cur) } catch { return }
    for (const name of names) await walk(path.join(cur, name))
  }
  await walk(p)
  return out
}

const add = (a, b) => { a.size += b.size; a.disk += b.disk; a.files += b.files; a.dirs += b.dirs; return a }
const empty = () => ({ size: 0, disk: 0, files: 0, dirs: 0 })

function item(id, m, extra = {}) {
  return { id, size: m.size, disk: m.disk, files: m.files, ...extra }
}

// Per-table sizes of the library database (SQLite's dbstat), each table with
// its indexes, biggest first.
function tableSizes(db) {
  try {
    const rows = db.prepare('SELECT name, SUM(pgsize) AS size FROM dbstat GROUP BY name').all()
    const kinds = Object.fromEntries(db.prepare('SELECT name, type, tbl_name FROM sqlite_master').all().map(r => [r.name, r]))
    const tables = new Map()
    for (const r of rows) {
      const kind = kinds[r.name]
      const owner = kind?.tbl_name || r.name
      const t = tables.get(owner) || { name: owner, size: 0, data: 0, indexes: 0, indexCount: 0, rows: null }
      t.size += r.size || 0
      if (kind?.type === 'index' || (!kind && r.name !== owner)) { t.indexes += r.size || 0; t.indexCount++ } else t.data += r.size || 0
      tables.set(owner, t)
    }
    for (const t of tables.values()) {
      if (kinds[t.name]?.type !== 'table') continue
      try { t.rows = db.prepare(`SELECT COUNT(*) AS n FROM "${t.name.replace(/"/g, '""')}"`).get().n } catch {}
    }
    return [...tables.values()].sort((a, b) => b.size - a.size)
  } catch { return [] }
}

// Online songs kept as ghost tracks (ghost://<platform>/online/<id>, see
// electron/online/sources.js): rows in the database, not files.
//   kept     in a playlist or liked: never removed
//   history  only in the play history: removed by the full clean-up, with it
//   unused   nothing refers to them: removed by the safe clean-up
// bytes: their rough share of the tables they live in.
function ghostTracks(db) {
  const empty = () => ({ count: 0, ids: [], bytes: 0 })
  const out = { total: 0, unused: empty(), history: empty(), kept: { count: 0 } }
  if (!db) return out
  let rows = []
  try { rows = db.prepare("SELECT id, liked FROM tracks WHERE file_path LIKE 'ghost://%'").all() } catch { return out }
  out.total = rows.length
  if (!rows.length) return out
  const idsIn = (sql) => { try { return new Set(db.prepare(sql).all().map(r => r.track_id)) } catch { return new Set() } }
  const kept = new Set([...idsIn('SELECT DISTINCT track_id FROM playlist_tracks'), ...idsIn('SELECT DISTINCT track_id FROM user_likes')])
  const counts = (table) => { try { return new Map(db.prepare(`SELECT track_id, COUNT(*) AS n FROM ${table} GROUP BY track_id`).all().map(r => [r.track_id, r.n])) } catch { return new Map() } }
  const pageBytes = (pattern) => { try { return db.prepare('SELECT COALESCE(SUM(pgsize), 0) AS s FROM dbstat WHERE name LIKE ?').get(pattern).s } catch { return 0 } }
  const rowCount = (table) => { try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n || 1 } catch { return 1 } }
  const history = { play_history: counts('play_history'), listening_events: counts('listening_events') }
  // The row in tracks, and about as much again in the search index (a ghost
  // has no lyrics there, which is most of that index's size).
  const perTrack = 2 * pageBytes('tracks') / rowCount('tracks')
  const perRow = Object.fromEntries(Object.keys(history).map(t => [t, pageBytes(t) / rowCount(t)]))
  for (const row of rows) {
    if (row.liked || kept.has(row.id)) { out.kept.count++; continue }
    let size = perTrack
    let played = false
    for (const [table, map] of Object.entries(history)) {
      const n = map.get(row.id) || 0
      if (n) { played = true; size += n * perRow[table] }
    }
    const group = played ? out.history : out.unused
    group.count++
    group.ids.push(row.id)
    group.bytes += size
  }
  out.unused.bytes = Math.round(out.unused.bytes)
  out.history.bytes = Math.round(out.history.bytes)
  return out
}

// Covers in data/artwork: by kind, plus the ones nothing in the library uses any more.
async function artwork(dir, db) {
  const m = await measure(dir, { keepFiles: true })
  // A cover is in use when a row points at it, or when it's named after a
  // track, artist or playlist that's still there (t-<id>.jpg, artist-<id>.jpg...).
  const used = new Set()
  const ids = new Set()
  if (db) {
    const norm = p => (p ? path.resolve(String(p)).toLowerCase() : null)
    for (const sql of ['SELECT artwork_path AS p FROM tracks', 'SELECT image_path AS p FROM artists', 'SELECT cover_path AS p FROM playlists']) {
      try { for (const r of db.prepare(sql).all()) { const p = norm(r.p); if (p) used.add(p) } } catch {}
    }
    for (const [sql, prefix] of [['SELECT id FROM tracks', ''], ['SELECT id FROM artists', 'artist-'], ['SELECT id FROM playlists', 'playlist-']]) {
      try { for (const r of db.prepare(sql).all()) ids.add(`${prefix}${r.id}`.toLowerCase()) } catch {}
    }
  }
  const isUsed = file => {
    if (used.has(path.resolve(file).toLowerCase())) return true
    const stem = path.basename(file).replace(/\.[^.]+$/, '').toLowerCase()
    // A full-size sibling is obsolete once the same song has a thumbnail.
    // A direct database path above still protects a manually chosen image.
    const ext = path.extname(file).toLowerCase()
    const thumb = path.join(path.dirname(file), stem + '.webp')
    return ids.has(stem) && ext !== '.webp' && !fs.existsSync(thumb)
  }
  const kinds = { coverThumbs: empty(), trackCovers: empty(), artistImages: empty(), playlistCovers: empty(), otherArtwork: empty() }
  const unused = empty()
  const unusedFiles = []
  for (const f of m.list) {
    const name = path.basename(f.path)
    const kind = name.startsWith('artist-') ? 'artistImages' : name.startsWith('playlist-') ? 'playlistCovers'
      : /^t-|^[0-9a-f]{8,}/i.test(name) ? (/\.webp$/i.test(name) ? 'coverThumbs' : 'trackCovers') : 'otherArtwork'
    const one = { size: f.size, disk: onDisk(f.size), files: 1, dirs: 0 }
    add(kinds[kind], one)
    if (db && !isUsed(f.path)) { add(unused, one); unusedFiles.push(f.path) }
  }
  const largest = m.list.sort((a, b) => b.size - a.size)[0]
  return {
    total: m,
    items: Object.entries(kinds).filter(([, k]) => k.files).map(([id, k]) => item(id, k, { average: Math.round(k.size / k.files) })),
    unused: db ? item('unusedArtwork', unused) : null,
    unusedFiles,
    largest: largest ? { name: path.basename(largest.path), size: largest.size } : null,
  }
}

// What each clean-up button (electron/cacheCleanup.js) would free, in bytes,
// from the files just counted. Mirrors what clean() removes.
const ENGINE_CACHE = new Set(['Cache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'ShaderCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GPUPersistentCache'])
const SITE_DATA = new Set(['Network', 'IndexedDB', 'Service Worker', 'blob_storage', 'Shared Dictionary'])
const SAFE_DATA = new Set(['motion-covers', 'playback-cache', 'cast-cache'])
function cleanupEstimate({ files, userData, dataDir, unusedFiles = [], activePartition, currentLog, freeBytes = 0, ghosts }) {
  const lower = p => path.resolve(p).toLowerCase()
  const unused = new Set(unusedFiles.map(lower))
  const active = String(activePartition || '').replace(/^persist:/, '').toLowerCase()
  const keepLog = currentLog ? lower(currentLog) : null
  const kind = (file) => {
    if (unused.has(lower(file))) return 'safe'
    if (dataDir && lower(file).startsWith(lower(dataDir) + path.sep)) {
      const parts = path.relative(dataDir, file).split(path.sep)
      if (SAFE_DATA.has(parts[0]) || (parts[0] === 'spotiflac' && parts[1] === 'audio-cache')) return 'safe'
      if (parts.length === 1 && parts[0] === 'lokal.db-wal') return 'safe'
      if (parts[0] === 'music-video-cache' || /^youtube-cookies/.test(parts[0])) return 'full'
      return null
    }
    const parts = path.relative(userData, file).split(path.sep)
    if (ENGINE_CACHE.has(parts[0])) return 'safe'
    if (parts[0] === 'logs') return parts.length === 2 && parts[1] !== 'main.log' && lower(file) !== keepLog ? 'safe' : null
    if (parts[0] === 'Partitions' && parts.length > 2) {
      if (/^lokal-ytmusic-[\da-f-]+$/i.test(parts[1]) && parts[1].toLowerCase() !== active) return 'safe'
      if (ENGINE_CACHE.has(parts[2])) return 'safe'
      return 'full'
    }
    if (SITE_DATA.has(parts[0])) return 'full'
    return null
  }
  let safe = freeBytes + (ghosts?.unused.bytes || 0)
  let full = ghosts?.history.bytes || 0
  for (const f of files) {
    const k = kind(f.path)
    if (k === 'safe') safe += f.size
    else if (k === 'full') full += f.size
  }
  return { safe, full: safe + full }
}

async function children(dir) {
  try { return await fs.promises.readdir(dir) } catch { return [] }
}

/**
 * The full report. `userData`: the app's folder; `dataDir`: Lokal's data folder
 * (usually userData/data); `db`: the open library database.
 */
async function analyze({ userData, dataDir, db, onProgress, activePartition, currentLog }) {
  const groups = { database: [], artwork: [], lokalCache: [], userFiles: [], tools: [], browserCache: [], sessions: [], logs: [], appState: [], other: [] }
  const allFiles = []
  const step = (label) => { try { onProgress?.(label) } catch {} }
  const push = (group, entry) => groups[group].push(entry)
  let database = null
  let artworkInfo = null

  const scanData = async (dir) => {
    for (const name of await children(dir)) {
      const p = path.join(dir, name)
      step(path.relative(userData, p) || name)
      if (name === 'artwork') {
        artworkInfo = await artwork(p, db)
        allFiles.push(...artworkInfo.total.list)
        for (const it of artworkInfo.items) push('artwork', it)
        continue
      }
      const m = await measure(p, { keepFiles: true })
      allFiles.push(...m.list)
      if (/^lokal\.db(-wal|-shm|-journal)?$/.test(name)) {
        const id = name.endsWith('-wal') ? 'dbWal' : name.endsWith('-shm') ? 'dbShm' : name.endsWith('-journal') ? 'dbJournal' : 'dbMain'
        push('database', item(id, m))
      } else if (/\.db(-wal|-shm|-journal)?$|\.sqlite3?$/.test(name)) {
        push('database', item('otherDb', m, { name }))
      } else if (DATA_DIRS[name]) {
        push(['lyricsFiles', 'avatars', 'plugins'].includes(DATA_DIRS[name]) ? 'userFiles' : 'lokalCache', item(DATA_DIRS[name], m))
      } else if (/^youtube-cookies/.test(name)) {
        push('appState', item('youtubeCookies', m, { name }))
      } else {
        push('other', item('raw', m, { name: `data/${name}` }))
      }
    }
  }

  const dataInside = dataDir && path.resolve(path.dirname(dataDir)).toLowerCase() === path.resolve(userData).toLowerCase()
  for (const name of await children(userData)) {
    const p = path.join(userData, name)
    step(name)
    if (dataInside && path.resolve(p).toLowerCase() === path.resolve(dataDir).toLowerCase()) { await scanData(p); continue }
    if (name === 'Partitions') {
      for (const part of await children(p)) {
        const m = await measure(path.join(p, part), { keepFiles: true })
        allFiles.push(...m.list)
        const id = /^lokal-ytmusic/.test(part) ? 'ytMusicSession' : /youtube-attest/.test(part) ? 'youtubeAttest' : 'webSession'
        push('sessions', item(id, m, { name: part }))
      }
      continue
    }
    const m = await measure(p, { keepFiles: true })
    allFiles.push(...m.list)
    if (name === 'bin') {
      for (const f of m.list) push('tools', item('tool', { size: f.size, disk: onDisk(f.size), files: 1 }, { name: path.relative(p, f.path) }))
    } else if (BROWSER_CACHE.has(name)) push('browserCache', item('raw', m, { name }))
    else if (name === 'logs' || /\.log$/i.test(name)) push('logs', item('raw', m, { name }))
    else if (name === 'music-videos.json') push('lokalCache', item('musicVideoIndex', m))
    else if (APP_STATE.has(name)) push('appState', item('raw', m, { name }))
    else push('other', item('raw', m, { name }))
  }
  // Data kept outside the app folder (LOKAL_DATA_DIR): counted as well.
  if (dataDir && !dataInside) await scanData(dataDir)

  if (db) {
    const tables = tableSizes(db)
    let pageSize = 0, pages = 0, free = 0
    try { pageSize = db.pragma('page_size', { simple: true }); pages = db.pragma('page_count', { simple: true }); free = db.pragma('freelist_count', { simple: true }) } catch {}
    database = { tables, pageSize, pages, freeBytes: free * pageSize }
  }
  const ghosts = ghostTracks(db)
  if (ghosts.total) {
    // Ghost-track rows already live inside the SQLite file counted above.
    // Show their cleanup counts without adding the same bytes to disk totals.
    push('database', { id: 'ghostTracks', size: 0, disk: 0, files: 0, rows: ghosts.total, unused: ghosts.unused.count, history: ghosts.history.count, kept: ghosts.kept.count })
  }

  const sections = Object.entries(groups).map(([id, items]) => {
    const total = items.reduce((a, it) => add(a, { size: it.size, disk: it.disk, files: it.files, dirs: 0 }), empty())
    return { id, size: total.size, disk: total.disk, files: total.files, items: items.sort((a, b) => b.size - a.size) }
  }).filter(s => s.items.length).sort((a, b) => b.size - a.size)

  const total = sections.reduce((a, s) => add(a, { size: s.size, disk: s.disk, files: s.files, dirs: 0 }), empty())
  const cleanup = cleanupEstimate({ files: allFiles, userData, dataDir, unusedFiles: artworkInfo?.unusedFiles, activePartition, currentLog, freeBytes: database?.freeBytes, ghosts })
  const largestFiles = allFiles.sort((a, b) => b.size - a.size).slice(0, 15)
    .map(f => ({ path: path.relative(userData, f.path) || f.path, size: f.size }))

  return {
    root: userData,
    dataDir,
    finishedAt: Date.now(),
    total,
    sections,
    database,
    artwork: artworkInfo && { files: artworkInfo.total.files, size: artworkInfo.total.size, unused: artworkInfo.unused, largest: artworkInfo.largest },
    largestFiles,
    cleanup,
    ghosts: { total: ghosts.total, unused: ghosts.unused.count, history: ghosts.history.count, kept: ghosts.kept.count },
  }
}

module.exports = { analyze, artwork, measure, ghostTracks }
