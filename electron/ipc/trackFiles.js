// Settings > Library > "Delete files too": when a song is deleted in Lokal,
// its file goes as well. Off by default. Only files inside the music folder
// are touched (anything else is left alone and reported). The desktop app
// moves them to the Recycle Bin / Trash; the web server, which has no trash,
// deletes them for good.

const fs = require('fs-extra')
const path = require('path')

function deleteFilesEnabled(db) {
  try { return db.prepare("SELECT value FROM settings WHERE key = 'delete_files_from_disk'").get()?.value === '1' } catch { return false }
}

function musicFolder(db) {
  try { return db.prepare("SELECT value FROM settings WHERE key = 'music_folder'").get()?.value || '' } catch { return '' }
}

/** true when `file` is strictly inside `folder` (after resolving . and ..). */
function isInside(file, folder) {
  if (!file || !folder) return false
  const rel = path.relative(path.resolve(folder), path.resolve(file))
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

async function moveToTrash(file) {
  let shell = null
  if (process.versions.electron) {
    try { shell = require('electron').shell } catch {}
  }
  if (shell?.trashItem) return shell.trashItem(file)
  return fs.remove(file)
}

/**
 * Deletes the files of songs just removed from the library, if the setting is
 * on. Returns { removed, skipped, failed } (paths), or null when it's off.
 */
async function removeTrackFiles(db, filePaths) {
  if (!deleteFilesEnabled(db)) return null
  const folder = musicFolder(db)
  // Compared as real paths, so a symlink inside the folder that points
  // elsewhere doesn't count as inside it.
  const realFolder = folder ? await fs.realpath(folder).catch(() => null) : null
  const result = { removed: [], skipped: [], failed: [] }
  for (const file of [...new Set((filePaths || []).filter(Boolean))]) {
    if (!isInside(file, folder)) { result.skipped.push(file); continue }
    try {
      if (!(await fs.pathExists(file))) continue
      const realFile = await fs.realpath(file)
      if (!realFolder || !isInside(realFile, realFolder)) { result.skipped.push(file); continue }
      await moveToTrash(file)
      result.removed.push(file)
    } catch {
      result.failed.push(file)
    }
  }
  return result
}

/**
 * Tells the download queue these songs are gone, so a finished download of
 * them stops showing as saved (and can be downloaded again).
 */
function forgetDownloads(trackIds) {
  try { require('../download/manager').getDownloadManager().forgetTracks(trackIds) } catch {}
}

module.exports = { moveToTrash, removeTrackFiles, forgetDownloads, deleteFilesEnabled, isInside }
