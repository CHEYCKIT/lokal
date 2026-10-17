// After a scan: songs whose file is gone from the music folder leave the
// library. A file that was only moved or renamed (a folder renamed, say) was
// indexed again under its new path by the scan; the old entry hands its
// likes, plays and playlist places to that one before it goes. Without a new
// copy the entry is removed like a song deleted in Lokal.
//
// Nothing is removed when the scan found no files at all: the music folder
// (or its drive) being unavailable must not empty the library.

const fs = require('fs')
const path = require('path')

/** Every table with a track_id column (likes, plays, playlists, lyrics...). */
function trackTables(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'tracks'").all().map(row => row.name)
  return tables.filter(name => {
    try { return db.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all().some(column => column.name === 'track_id') } catch { return false }
  })
}

const sameSong = (a, b) =>
  String(a.title || '').trim().toLowerCase() === String(b.title || '').trim().toLowerCase() &&
  String(a.artist || '').trim().toLowerCase() === String(b.artist || '').trim().toLowerCase() &&
  (!a.duration || !b.duration || Math.abs(Number(a.duration) - Number(b.duration)) < 2)

/** The file_path range of everything inside `dir`: [prefix, upper). */
function pathRange(dir) {
  const root = path.resolve(dir)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  const upper = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)
  return [prefix, upper]
}

/** Removes the `stale` rows; each hands what it has to `copyOf(row)`, when there is one. */
function dropTracks(db, stale, copyOf) {
  if (!stale.length) return { removed: 0, moved: 0 }
  const tables = trackTables(db)
  let moved = 0
  const run = db.transaction(() => {
    for (const old of stale) {
      const copy = copyOf(old)
      for (const table of tables) {
        const quoted = `"${table.replace(/"/g, '""')}"`
        if (copy) { try { db.prepare(`UPDATE OR IGNORE ${quoted} SET track_id = ? WHERE track_id = ?`).run(copy.id, old.id) } catch {} }
        try { db.prepare(`DELETE FROM ${quoted} WHERE track_id = ?`).run(old.id) } catch {}
      }
      if (copy) {
        db.prepare('UPDATE tracks SET play_count = COALESCE(play_count, 0) + ? WHERE id = ?').run(Number(old.play_count) || 0, copy.id)
        moved++
      }
      db.prepare('DELETE FROM tracks WHERE id = ?').run(old.id)
    }
    // Artists left without a song go too.
    try { db.prepare('DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM artist_track_links)').run() } catch {}
  })
  run()
  return { removed: stale.length - moved, moved }
}

/**
 * @param folderPath    the music folder just scanned
 * @param scannedFiles  the audio files the scan found in it
 * -> { removed, moved }
 */
function pruneMissingTracks(db, folderPath, scannedFiles, { exists = fs.existsSync } = {}) {
  if (!folderPath || !Array.isArray(scannedFiles) || !scannedFiles.length || !exists(folderPath)) return { removed: 0, moved: 0 }
  const [prefix, upper] = pathRange(folderPath)
  const found = new Set(scannedFiles.map(file => path.resolve(file).toLowerCase()))
  const rows = db.prepare("SELECT * FROM tracks WHERE file_path >= ? AND file_path < ? AND file_path NOT LIKE 'ghost://%'").all(prefix, upper)
  const stale = rows.filter(row => !found.has(path.resolve(row.file_path).toLowerCase()) && !exists(row.file_path))
  const present = rows.filter(row => !stale.includes(row))
  return dropTracks(db, stale, old => present.find(row => sameSong(row, old)))
}

/**
 * The folder watcher saw these paths go (files, or whole folders deleted or
 * renamed): their songs leave the library, each handing its plays, likes and
 * playlist places to a copy that's still on disk (the same file under its
 * new name), when there is one.
 * -> { removed, moved, ids }
 */
function pruneGonePaths(db, gonePaths, { exists = fs.existsSync } = {}) {
  const stale = new Map()
  const byPath = db.prepare('SELECT * FROM tracks WHERE file_path = ?')
  const inside = db.prepare('SELECT * FROM tracks WHERE file_path >= ? AND file_path < ?')
  for (const gone of gonePaths || []) {
    if (!gone || exists(gone)) continue
    const rows = [byPath.get(path.resolve(gone)), ...inside.all(...pathRange(gone))]
    for (const row of rows) if (row && !String(row.file_path).startsWith('ghost://') && !exists(row.file_path)) stale.set(row.id, row)
  }
  if (!stale.size) return { removed: 0, moved: 0, ids: [] }
  const sameTitle = db.prepare("SELECT * FROM tracks WHERE title = ? COLLATE NOCASE AND file_path NOT LIKE 'ghost://%'")
  const copyOf = old => sameTitle.all(String(old.title || '')).find(row => !stale.has(row.id) && sameSong(row, old) && exists(row.file_path))
  return { ...dropTracks(db, [...stale.values()], copyOf), ids: [...stale.keys()] }
}

module.exports = { pruneMissingTracks, pruneGonePaths, dropTracks }
