const path = require('path')
const fs = require('fs-extra')

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.aac', '.opus', '.wma', '.alac', '.ape'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])

function findFolderArtwork(folderPath) {
  try {
    const images = fs.readdirSync(folderPath, { withFileTypes: true })
      .filter(entry => entry.isFile() && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase()))
      .map(entry => entry.name)
    if (!images.length) return null

    const priority = (name) => {
      const stem = path.parse(name).name.toLowerCase().replace(/[\s_-]+/g, '')
      if (stem === 'cover') return 0
      if (stem === 'folder') return 1
      if (stem === 'front') return 2
      if (stem === 'albumart') return 3
      if (stem === 'album') return 4
      if (stem === 'art') return 5
      return 99
    }
    images.sort((left, right) =>
      priority(left) - priority(right) ||
      left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
    )
    return path.join(folderPath, images[0])
  } catch {
    return null
  }
}

function isOutside(basePath, candidatePath) {
  const relative = path.relative(basePath, candidatePath)
  return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)
}

function getPathPrefixBounds(folderPath) {
  const prefix = folderPath.endsWith(path.sep) ? folderPath : folderPath + path.sep
  const separatorCode = prefix.charCodeAt(prefix.length - 1)
  return {
    prefix,
    // The prefix ends with an ASCII path separator. Advancing that character
    // gives a safe exclusive upper bound, including names beginning with emoji.
    upperBound: prefix.slice(0, -1) + String.fromCharCode(separatorCode + 1),
  }
}

function isExistingFile(filePath) {
  try {
    return typeof filePath === 'string' && fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function getExistingTrackPaths(db, folderPath) {
  if (!db || typeof db.prepare !== 'function') return []
  const { prefix, upperBound } = getPathPrefixBounds(folderPath)
  try {
    const rows = db.prepare(
      "SELECT file_path FROM tracks WHERE file_path >= ? AND file_path < ? AND file_path NOT LIKE 'ghost://%' ORDER BY file_path ASC"
    ).all(prefix, upperBound) || []
    return rows.map(row => row.file_path).filter(isExistingFile)
  } catch {
    return []
  }
}

function getTracksForPaths(db, filePaths) {
  if (!db || typeof db.prepare !== 'function' || !filePaths.length) return []
  const tracks = []
  for (let i = 0; i < filePaths.length; i += 500) {
    const batch = filePaths.slice(i, i + 500)
    const placeholders = batch.map(() => '?').join(',')
    try {
      tracks.push(...db.prepare(
        "SELECT * FROM tracks WHERE file_path IN (" + placeholders + ") AND file_path NOT LIKE 'ghost://%'"
      ).all(...batch))
    } catch {}
  }
  const byPath = new Map(tracks.filter(track => isExistingFile(track.file_path)).map(track => [track.file_path, track]))
  return filePaths.map(filePath => byPath.get(filePath)).filter(Boolean)
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, character => '\\' + character)
}

function getLibraryFolders(db, relativePath = '', search = '') {
  const configuredRoot = db.prepare("SELECT value FROM settings WHERE key = 'music_folder'").get()?.value
  if (!configuredRoot) {
    return { available: false, error: 'No music folder selected', rootName: '', relativePath: '', folders: [], tracks: [], trackCount: 0, totalTracks: 0 }
  }

  const rootPath = path.resolve(String(configuredRoot))
  const requestedPath = typeof relativePath === 'string' ? relativePath.slice(0, 4096) : ''
  const targetPath = path.resolve(rootPath, requestedPath || '.')
  const relative = path.relative(rootPath, targetPath)
  const normalizedRelative = relative && relative !== '.' ? relative.split(path.sep).join('/') : ''
  const rootName = path.basename(rootPath) || rootPath
  const empty = (error, notFound = false) => ({
    available: true, error, notFound, rootName, relativePath: normalizedRelative, folders: [], tracks: [], trackCount: 0, totalTracks: 0,
  })

  if (isOutside(rootPath, targetPath)) return empty('Folder is outside the selected music folder', true)

  let entries
  try {
    const realRoot = fs.realpathSync(rootPath)
    const realTarget = fs.realpathSync(targetPath)
    if (isOutside(realRoot, realTarget) || !fs.statSync(realTarget).isDirectory()) {
      return empty('Folder is not available inside the selected music folder', true)
    }
    entries = fs.readdirSync(targetPath, { withFileTypes: true })
  } catch {
    return empty('This folder is no longer available', true)
  }

  // Query descendant paths once, not once per child folder. Verify they still
  // exist so stale index rows do not inflate counts or Play All.
  const descendantTrackPaths = getExistingTrackPaths(db, targetPath)
  const folderTrackCounts = new Map()
  for (const filePath of descendantTrackPaths) {
    const relativeTrackPath = path.relative(targetPath, filePath)
    const separator = relativeTrackPath.indexOf(path.sep)
    if (separator <= 0) continue
    const childName = relativeTrackPath.slice(0, separator)
    const childKey = process.platform === 'win32' ? childName.toLowerCase() : childName
    folderTrackCounts.set(childKey, (folderTrackCounts.get(childKey) || 0) + 1)
  }

  const folders = entries
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const fullPath = path.join(targetPath, entry.name)
      const childRelative = path.relative(rootPath, fullPath).split(path.sep).join('/')
      const childKey = process.platform === 'win32' ? entry.name.toLowerCase() : entry.name
      return { name: entry.name, path: childRelative, trackCount: folderTrackCounts.get(childKey) || 0 }
    })
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }))

  const trackPaths = entries
    .filter(entry => entry.isFile() && AUDIO_EXTS.has(path.extname(entry.name).toLowerCase()))
    .map(entry => path.join(targetPath, entry.name))
  const tracks = []
  for (let i = 0; i < trackPaths.length; i += 500) {
    const batch = trackPaths.slice(i, i + 500)
    if (!batch.length) continue
    const placeholders = batch.map(() => '?').join(',')
    tracks.push(...db.prepare(
      "SELECT * FROM tracks WHERE file_path IN (" + placeholders + ") AND file_path NOT LIKE 'ghost://%'"
    ).all(...batch))
  }

  tracks.sort((left, right) =>
    String(left.title || '').localeCompare(String(right.title || ''), undefined, { numeric: true, sensitivity: 'base' })
  )

  const { prefix: targetPrefix, upperBound: targetUpperBound } = getPathPrefixBounds(targetPath)
  const totalTracks = Math.max(tracks.length, descendantTrackPaths.length)

  // Play All should include every existing descendant when the current folder
  // itself has no direct tracks. Batch IN lookups to stay under SQLite's bind limit.
  let allTracks = tracks
  if (tracks.length === 0 && totalTracks > 0) {
    allTracks = getTracksForPaths(db, descendantTrackPaths)
  }

  const query = typeof search === 'string' ? search.trim() : ''
  let deepTracks = []
  if (query) {
    const term = '%' + escapeLike(query) + '%'
    const likeEscape = " ESCAPE '" + String.fromCharCode(92) + "'"
    try {
      if (db && typeof db.prepare === 'function') {
        const sql = "SELECT * FROM tracks WHERE file_path >= ? AND file_path < ? AND (" +
          "title LIKE ?" + likeEscape + " OR " +
          "artist LIKE ?" + likeEscape + " OR " +
          "album LIKE ?" + likeEscape + " OR " +
          "substr(file_path, length(?)+1) LIKE ?" + likeEscape + ") " +
          "AND file_path NOT LIKE 'ghost://%' ORDER BY file_path ASC"
        const stmt = db.prepare(sql)
        if (stmt && typeof stmt.all === 'function') {
          deepTracks = (stmt.all(targetPrefix, targetUpperBound, term, term, term, targetPrefix, term) || [])
            .filter(track => isExistingFile(track.file_path))
          for (const track of deepTracks) {
            const trackDir = path.dirname(track.file_path)
            const subRel = path.relative(rootPath, trackDir).split(path.sep).join('/')
            track.subfolderPath = subRel
          }
        }
      }
    } catch {}
  }

  return {
    available: true,
    rootName,
    relativePath: normalizedRelative,
    folders,
    tracks,
    trackCount: tracks.length,
    totalTracks,
    allTracks,
    deepTracks,
    search: query,
  }
}

module.exports = { findFolderArtwork, getLibraryFolders }

