// Move completed downloads into a configured relative folder inside the music
// library, then number them in their file tags. The folder path is validated at
// every segment so this setting cannot escape the library through traversal or symlinks.
const fs = require('fs-extra')
const path = require('path')
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.aac', '.opus', '.wma', '.alac', '.ape'])
const SIDECARS = ['.lrc', '.elrc', '.ttml', '.txt']

function samePath(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
function inside(parent, child) {
  const relative = path.relative(parent, child)
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
function configuredRoots(db) {
  const plural = db.prepare("SELECT value FROM settings WHERE key = 'music_folders'").get()?.value
  let roots = []
  try { roots = Array.isArray(JSON.parse(plural || 'null')) ? JSON.parse(plural) : [] } catch {}
  if (!roots.length) {
    const one = db.prepare("SELECT value FROM settings WHERE key = 'music_folder'").get()?.value
    if (one) roots = [one]
  }
  return roots.filter(value => typeof value === 'string' && value.trim()).map(value => path.resolve(value.trim()))
}

/** Create (if needed) a directory strictly inside the first configured music root. */
function targetFolder(db, relativeFolder) {
  const root = configuredRoots(db)[0]
  const raw = typeof relativeFolder === 'string' ? relativeFolder.trim().replace(/\\/g, '/') : ''
  if (!root || !raw) return null
  const segments = raw.split('/')
  if (raw.startsWith('/') || /^[a-z]:/i.test(raw) ||
      segments.some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) {
    throw new Error('Choose a relative folder inside the music library')
  }
  const realRoot = fs.realpathSync(root)
  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Download folder must not contain a symlink or file')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      fs.mkdirSync(current)
    }
    const real = fs.realpathSync(current)
    if (!inside(realRoot, real)) throw new Error('Download folder is outside the music library')
  }
  return path.resolve(current)
}

/** Highest track number among indexed files directly in this folder. */
function maxTrackNumber(db, dir) {
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep
  const upperBound = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)
  let rows = []
  try {
    rows = db.prepare("SELECT file_path, track_num FROM tracks WHERE file_path >= ? AND file_path < ? AND file_path NOT LIKE 'ghost://%'").all(prefix, upperBound)
  } catch {}
  return rows.reduce((max, row) => samePath(path.dirname(row.file_path), dir) ? Math.max(max, Number(row.track_num) || 0) : max, 0)
}

function freeName(dir, basename) {
  const ext = path.extname(basename)
  const stem = path.basename(basename, ext)
  let target = path.join(dir, basename)
  for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, stem + ' (' + i + ')' + ext)
  return target
}

function writeTrackNumber(filePath, number) {
  const T = require('node-taglib-sharp')
  if (!filePath || !fs.existsSync(filePath)) throw new Error('File not found')
  let file
  try {
    file = T.File.createFromPath(filePath)
    const mp3 = /\\.mp3$/i.test(filePath)
    const hadId3v1 = typeof file.tagTypesOnDisk === 'number' && (file.tagTypesOnDisk & T.TagTypes.Id3v1) !== 0
    file.tag.track = Math.max(1, Math.floor(Number(number) || 1))
    if (mp3 && !hadId3v1) { try { file.removeTags(T.TagTypes.Id3v1) } catch {} }
    try { require('./syltEncoding').aimpSafeSylt(T, file) } catch {}
    file.save()
  } catch (error) {
    const busy = /EBUSY|EPERM|EACCES/i.test(String(error?.code || error?.message || ''))
    throw new Error(busy ? 'The file is in use or read-only' : (error?.message || String(error)))
  } finally {
    try { file?.dispose() } catch {}
  }
}

/**
 * assignedNumbers belongs to one download job, so files from a playlist get
 * consecutive numbers even before the scanner has inserted their database rows.
 */
function placeDownload(db, filePath, relativeFolder, assignedNumbers = {}) {
  if (!relativeFolder || !String(relativeFolder).trim() || !filePath || !fs.existsSync(filePath)) return { filePath, trackNum: null }
  if (!AUDIO_EXTS.has(path.extname(filePath).toLowerCase())) return { filePath, trackNum: null }
  let dir
  try { dir = targetFolder(db, relativeFolder) } catch (error) {
    console.warn('[downloadFolder] Invalid folder:', error.message)
    return { filePath, trackNum: null, error: error.message }
  }
  if (!dir) return { filePath, trackNum: null }
  let target = filePath
  if (!samePath(path.dirname(filePath), dir)) {
    try {
      target = freeName(dir, path.basename(filePath))
      fs.moveSync(filePath, target, { overwrite: false })
    } catch (error) {
      console.warn('[downloadFolder] Could not move file:', error.message)
      return { filePath, trackNum: null, error: error.message }
    }
    const oldStem = filePath.slice(0, -path.extname(filePath).length)
    const newStem = target.slice(0, -path.extname(target).length)
    for (const ext of SIDECARS) {
      try { if (fs.existsSync(oldStem + ext) && !fs.existsSync(newStem + ext)) fs.moveSync(oldStem + ext, newStem + ext) } catch {}
    }
  }
  const key = process.platform === 'win32' ? dir.toLowerCase() : dir
  const number = Math.max(maxTrackNumber(db, dir), Number(assignedNumbers[key]) || 0) + 1
  try {
    writeTrackNumber(target, number)
    assignedNumbers[key] = number
    try { require('./fileStamp').noteFileWritten(db, target) } catch {}
    return { filePath: target, trackNum: number, dir }
  } catch (error) {
    console.warn('[downloadFolder] Could not write track number:', error.message)
    return { filePath: target, trackNum: null, error: error.message }
  }
}

module.exports = { targetFolder, maxTrackNumber, writeTrackNumber, placeDownload }
