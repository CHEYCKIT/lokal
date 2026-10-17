// Watches the music folder, the way AIMP does: Windows says which files
// changed (fs.watch is ReadDirectoryChangesW there) and only those are read
// again. A tag editor renumbering a whole album arrives as one batch; a file
// deleted or renamed in Explorer leaves (or moves in) the library at once.
//
// What happens while the app is closed is the next scan's job: it compares
// each file's modification time with the library's and reads only those that
// differ.

const fs = require('fs')
const path = require('path')

// Events settle this long before a batch is read (a tagger saving 300 files
// is one batch, not 300).
const QUIET_MS = 400
// A file modified this recently may still be being written (a download, a
// copy): it waits.
const SETTLE_MS = 1500
// Windows lists changes in a small buffer: a mass edit (a tagger saving a
// whole folder) overflows it and arrives as "something changed". Once the
// events stop for this long, a scan catches up: it reads only the files whose
// modification time changed, the rest cost a stat.
const CATCH_UP_MS = 800
// The watcher failed (the folder went away): a scan, then watching again.
const RECOVER_MS = 3000

let watchers = new Map()
let roots = []
let root = null // legacy primary root for diagnostics
let timer = null
let running = null
let recovering = null
let catchUp = null
const pending = new Map() // path -> whether it appeared/went (vs changed)
const catchUpRoots = new Set()

function broadcast(channel, payload) {
  const { BrowserWindow } = require('electron')
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function schedule(ms = QUIET_MS) {
  clearTimeout(timer)
  timer = setTimeout(flush, ms)
}

function queue(filePath, renamed) {
  pending.set(filePath, pending.get(filePath) || renamed)
  schedule()
}

async function flush() {
  timer = null
  if (running) return schedule()
  const now = Date.now()
  const ready = []
  for (const [filePath, renamed] of pending) {
    let stat = null
    try { stat = fs.statSync(filePath) } catch {}
    if (stat?.isFile() && now - stat.mtimeMs < SETTLE_MS) continue
    ready.push({ path: filePath, renamed })
    pending.delete(filePath)
  }
  if (pending.size) schedule(SETTLE_MS)
  if (!ready.length) return
  // Directory renames/deletions can affect many descendant paths at once.
  // Let the existing scanner reconcile those rows and find renamed copies;
  // individual-file updates continue through the incremental path below.
  const needsScan = ready.some(change => {
    if (!change.renamed) return false
    try { return fs.statSync(change.path).isDirectory() } catch { return true }
  })
  if (needsScan) {
    const affected = [...new Set(ready.map(change => rootForPath(change.path)).filter(Boolean))]
    for (const folder of affected) catchUpLater(folder)
    return
  }
  running = require('./ipc/scanner').applyFileChanges(ready)
    .then(({ added, updated, removed }) => {
      if (!added.length && !updated.length && !removed.length) return
      console.log(`[libraryWatcher] ${added.length} added, ${updated.length} updated, ${removed.length} removed`)
      broadcast('library:changed', { added, updated, removed })
    })
    .catch(e => console.warn('[libraryWatcher] Applying changes failed:', e.message))
    .finally(() => { running = null })
}

function configuredRoots() {
  try {
    const db = require('./ipc/db').getDB()
    const plural = db.prepare("SELECT value FROM settings WHERE key = 'music_folders'").get()?.value
    let values = []
    try { values = Array.isArray(JSON.parse(plural || 'null')) ? JSON.parse(plural) : [] } catch {}
    if (!values.length) {
      const legacy = db.prepare("SELECT value FROM settings WHERE key = 'music_folder'").get()?.value
      if (legacy) values = [legacy]
    }
    const seen = new Set()
    return values.filter(value => typeof value === 'string' && value.trim()).map(value => path.resolve(value.trim())).filter(value => {
      if (seen.has(value.toLowerCase())) return false
      seen.add(value.toLowerCase())
      return true
    })
  } catch { return [] }
}

function rootForPath(filePath) {
  const full = path.resolve(String(filePath || ''))
  for (const candidate of roots) {
    const relative = path.relative(candidate, full)
    if (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) return candidate
  }
  return null
}

function selectedRoot(folder) {
  const wanted = path.resolve(folder).toLowerCase()
  return configuredRoots().some(candidate => candidate.toLowerCase() === wanted)
}

function audioFiles(root) {
  const { AUDIO_EXTS } = require('./ipc/scanner')
  const files = []
  const walk = dir => {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) files.push(path.resolve(full))
    }
  }
  walk(root)
  return files
}

async function scan(folder) {
  const target = path.resolve(folder)
  if (!selectedRoot(target) || !fs.existsSync(target)) return
  const db = require('./ipc/db').getDB()
  const scanner = require('./ipc/scanner')
  const before = db.prepare("SELECT id, file_path, last_modified FROM tracks WHERE file_path NOT LIKE 'ghost://%'").all()
  await scanner.scanFolder(target, { saveRoot: false, watch: false })
  // A queued recovery can outlive the old watch. Never prune or publish its
  // results if another music folder was selected while the scan was running.
  if (!selectedRoot(target)) return
  const files = audioFiles(target)
  const oldRows = db.prepare("SELECT id, file_path, last_modified FROM tracks WHERE file_path NOT LIKE 'ghost://%'").all()
  const pruned = require('./libraryPrune').pruneMissingTracks(db, target, files)
  const after = db.prepare("SELECT id, file_path, last_modified FROM tracks WHERE file_path NOT LIKE 'ghost://%'").all()
  const afterIds = new Set(after.map(row => row.id))
  const beforeByPath = new Map(before.map(row => [path.resolve(row.file_path).toLowerCase(), row]))
  const oldById = new Map(oldRows.map(row => [row.id, row]))
  const afterByPath = new Map(after.map(row => [path.resolve(row.file_path).toLowerCase(), row]))
  const added = []
  const updated = []
  const removed = before.filter(row => !afterIds.has(row.id)).map(row => row.id)
  for (const row of after) {
    const prior = beforeByPath.get(path.resolve(row.file_path).toLowerCase())
    if (!prior) added.push(row.id)
    else if (prior.last_modified !== row.last_modified || prior.id !== row.id) updated.push(row.id)
  }
  // A move can replace an old row with a fresh ID while pruneMissingTracks
  // hands the new row its likes, plays and playlist references.
  if (added.length || updated.length || removed.length || pruned.removed || pruned.moved) {
    broadcast('library:changed', {
      added: [...new Set(added)],
      updated: [...new Set(updated)],
      removed: [...new Set(removed)],
    })
  }
}

/** Windows dropped events: a scan catches up once things are quiet. */
function catchUpLater(folder) {
  pending.clear()
  clearTimeout(timer)
  timer = null
  const target = path.resolve(folder)
  if (selectedRoot(target)) catchUpRoots.add(target)
  clearTimeout(catchUp)
  catchUp = setTimeout(async () => {
    catchUp = null
    const pendingRoots = [...catchUpRoots]
    catchUpRoots.clear()
    for (const candidate of pendingRoots) {
      if (selectedRoot(candidate)) {
        try { await scan(candidate) } catch (error) { console.warn('[libraryWatcher] Catch-up scan failed:', error.message) }
      }
    }
  }, CATCH_UP_MS)
}

/** The watcher stopped: catch up the failed root and restore all configured watchers. */
function recover(folder) {
  const target = path.resolve(folder)
  stopWatching()
  recovering = setTimeout(async () => {
    recovering = null
    if (selectedRoot(target)) {
      try { await scan(target) } catch (error) { console.warn('[libraryWatcher] Recovery scan failed:', error.message) }
    }
    watchLibraryRoots(configuredRoots())
  }, RECOVER_MS)
}

function watchLibrary(folder) {
  return watchLibraryRoots(folder ? [folder] : [])
}

/** Watch every selected music root; changes are batched through the same scanner. */
function watchLibraryRoots(folderPaths = []) {
  const nextRoots = []
  const seen = new Set()
  for (const value of Array.isArray(folderPaths) ? folderPaths : []) {
    if (typeof value !== 'string' || !value.trim()) continue
    const full = path.resolve(value.trim())
    let stat
    try { stat = fs.statSync(full) } catch { continue }
    if (!stat.isDirectory() || seen.has(full.toLowerCase())) continue
    seen.add(full.toLowerCase())
    nextRoots.push(full)
  }
  if (nextRoots.length === roots.length && nextRoots.every((value, index) => value.toLowerCase() === roots[index]?.toLowerCase()) && watchers.size === nextRoots.length) return

  stopWatching()
  roots = nextRoots
  root = nextRoots[0] || null
  for (const next of nextRoots) {
    try {
      const watcher = fs.watch(next, { recursive: true }, (type, name) => {
        // A missing filename or an overflow means the watcher dropped events;
        // a catch-up scan of that root is cheaper and safer than guessing.
        if (!name || catchUp) return catchUpLater(next)
        queue(path.join(next, String(name)), type === 'rename')
      })
      watcher.on('error', error => {
        console.warn('[libraryWatcher] Watching stopped:', error.message)
        recover(next)
      })
      watchers.set(next, watcher)
      console.log(`[libraryWatcher] Watching ${next}`)
    } catch (error) {
      console.warn('[libraryWatcher] Could not watch music folder:', next, error.message)
    }
  }
}

function stopWatching() {
  for (const watcher of watchers.values()) {
    try { watcher.close() } catch {}
  }
  watchers.clear()
  roots = []
  root = null
  clearTimeout(timer)
  timer = null
  clearTimeout(catchUp)
  catchUp = null
  catchUpRoots.clear()
  clearTimeout(recovering)
  recovering = null
  pending.clear()
}


module.exports = { watchLibrary, watchLibraryRoots, stopWatching }
