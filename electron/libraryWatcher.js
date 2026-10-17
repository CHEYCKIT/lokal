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

let watcher = null
let root = null
let timer = null
let running = null
let recovering = null
let catchUp = null
const pending = new Map() // path -> whether it appeared/went (vs changed)

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
  if (needsScan) { catchUpLater(root); return }
  running = require('./ipc/scanner').applyFileChanges(ready)
    .then(({ added, updated, removed }) => {
      if (!added.length && !updated.length && !removed.length) return
      console.log(`[libraryWatcher] ${added.length} added, ${updated.length} updated, ${removed.length} removed`)
      broadcast('library:changed', { added, updated, removed })
    })
    .catch(e => console.warn('[libraryWatcher] Applying changes failed:', e.message))
    .finally(() => { running = null })
}

function scan(folder) {
  require('./ipc/scanner').scanFolder(folder).catch(e => console.warn('[libraryWatcher] Catch-up scan failed:', e.message))
}

/** Windows dropped events: a scan catches up once things are quiet. */
function catchUpLater(folder) {
  pending.clear()
  clearTimeout(timer)
  timer = null
  clearTimeout(catchUp)
  catchUp = setTimeout(() => { catchUp = null; scan(folder) }, CATCH_UP_MS)
}

/** The watcher stopped: a scan catches up and watches the folder again. */
function recover(folder) {
  stopWatching()
  if (recovering) return
  recovering = setTimeout(() => {
    recovering = null
    scan(folder)
  }, RECOVER_MS)
}

/** Watches `folder` (the music folder); watching another one stops the old. */
function watchLibrary(folder) {
  const next = folder ? path.resolve(folder) : null
  if (watcher && next && root?.toLowerCase() === next.toLowerCase()) return
  stopWatching()
  if (!next || !fs.existsSync(next)) return
  try {
    watcher = fs.watch(next, { recursive: true }, (type, name) => {
      // No name: Windows dropped events (too many at once). Until the scan
      // that follows, single changes needn't be read: it reads them too.
      if (!name || catchUp) return catchUpLater(next)
      queue(path.join(next, String(name)), type === 'rename')
    })
    watcher.on('error', e => {
      console.warn('[libraryWatcher] Watching stopped:', e.message)
      recover(next)
    })
    root = next
    console.log(`[libraryWatcher] Watching ${next}`)
  } catch (e) {
    watcher = null
    console.warn('[libraryWatcher] Could not watch the music folder:', e.message)
  }
}

function stopWatching() {
  try { watcher?.close() } catch {}
  watcher = null
  root = null
  clearTimeout(timer)
  timer = null
  clearTimeout(catchUp)
  catchUp = null
  pending.clear()
}

module.exports = { watchLibrary, stopWatching }
