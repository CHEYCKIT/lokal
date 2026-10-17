const path = require('path')
const crypto = require('crypto')
const fs = require('fs-extra')

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.aac', '.opus', '.wma', '.alac', '.ape'])
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])

const artworkFingerprintCache = new Map()

function artworkFingerprint(filePath) {
  try {
    const fullPath = path.resolve(filePath)
    const stat = fs.statSync(fullPath)
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return null
    const cached = artworkFingerprintCache.get(fullPath)
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.fingerprint
    const fingerprint = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex')
    artworkFingerprintCache.set(fullPath, { size: stat.size, mtimeMs: stat.mtimeMs, fingerprint })
    if (artworkFingerprintCache.size > 2000) artworkFingerprintCache.delete(artworkFingerprintCache.keys().next().value)
    return fingerprint
  } catch {
    return null
  }
}

function imagePriority(name) {
  const stem = path.parse(name).name.toLowerCase().replace(/[\s_-]+/g, '')
  if (stem === 'cover') return 0
  if (stem === 'folder') return 1
  if (stem === 'front') return 2
  if (stem === 'albumart') return 3
  if (stem === 'album') return 4
  if (stem === 'art') return 5
  return 99
}

function findFolderArtwork(folderPath) {
  try {
    const images = fs.readdirSync(folderPath, { withFileTypes: true })
      .filter(entry => entry.isFile() && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase()))
      .map(entry => entry.name)
      .sort((left, right) =>
        imagePriority(left) - imagePriority(right) ||
        left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
      )
    if (!images.length) return null

    // A conventional filename is an explicit choice. Otherwise, use a lone
    // image or a set of byte-identical images, never an arbitrary unrelated one.
    if (imagePriority(images[0]) < 99) return path.join(folderPath, images[0])
    if (images.length === 1) return path.join(folderPath, images[0])
    // Keep fallback fingerprinting bounded; a large folder shouldn't make the main process hash hundreds of files.
    if (images.length > 32) return null
    let totalImageBytes = 0
    for (const name of images) {
      try { totalImageBytes += fs.statSync(path.join(folderPath, name)).size } catch { return null }
      if (totalImageBytes > 16 * 1024 * 1024) return null
    }
    const fingerprints = images.map(name => artworkFingerprint(path.join(folderPath, name)))
    if (fingerprints.some(fingerprint => !fingerprint)) return null
    return new Set(fingerprints).size === 1 ? path.join(folderPath, images[0]) : null
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
  if (normalizedRelative.split('/').some(segment => segment.startsWith('.'))) return empty('Dot-prefixed folders are hidden', true)

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
  if (normalizedRelative && descendantTrackPaths.length === 0) return empty('Folder has no tracks', true)
  const folderTrackCounts = new Map()
  for (const filePath of descendantTrackPaths) {
    const relativeTrackPath = path.relative(targetPath, filePath)
    const separator = relativeTrackPath.indexOf(path.sep)
    if (separator <= 0) continue
    const childName = relativeTrackPath.slice(0, separator)
    const childKey = process.platform === 'win32' ? childName.toLowerCase() : childName
    folderTrackCounts.set(childKey, (folderTrackCounts.get(childKey) || 0) + 1)
  }

  // If a child folder has no explicit cover/folder image, use distinct
  // artwork from its indexed tracks. Album folders normally yield one cover;
  // artist/collection folders can yield several and render a small collage.
  const indexedPathSet = new Set(descendantTrackPaths)
  const artworkByChild = new Map()
  try {
    const { prefix: artworkPrefix, upperBound: artworkUpperBound } = getPathPrefixBounds(targetPath)
    const rows = db.prepare(
      "SELECT id, file_path, artwork_path, artwork_url FROM tracks WHERE file_path >= ? AND file_path < ? AND file_path NOT LIKE 'ghost://%' AND (artwork_path IS NOT NULL OR artwork_url IS NOT NULL) ORDER BY file_path ASC"
    ).all(artworkPrefix, artworkUpperBound)
    for (const row of rows) {
      if (!indexedPathSet.has(row.file_path)) continue
      const relativeTrackPath = path.relative(targetPath, row.file_path)
      const separator = relativeTrackPath.indexOf(path.sep)
      if (separator <= 0) continue
      const childName = relativeTrackPath.slice(0, separator)
      const childKey = process.platform === 'win32' ? childName.toLowerCase() : childName
      const artworkPath = row.artwork_path && isExistingFile(row.artwork_path) ? row.artwork_path : null
      const artworkUrl = row.artwork_url || null
      if (!artworkPath && !artworkUrl) continue
      const fingerprint = artworkPath ? artworkFingerprint(artworkPath) : null
      const artworkIdentity = artworkPath
        ? (fingerprint ? 'image:' + fingerprint : 'file:' + (process.platform === 'win32' ? path.resolve(artworkPath).toLowerCase() : path.resolve(artworkPath)))
        : 'url:' + artworkUrl
      let covers = artworkByChild.get(childKey)
      if (!covers) { covers = new Map(); artworkByChild.set(childKey, covers) }
      if (!covers.has(artworkIdentity)) {
        covers.set(artworkIdentity, { id: row.id, artwork_path: artworkPath, artwork_url: artworkUrl })
      }
    }
  } catch {}

  const folders = entries
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const fullPath = path.join(targetPath, entry.name)
      const childRelative = path.relative(rootPath, fullPath).split(path.sep).join('/')
      const childKey = process.platform === 'win32' ? entry.name.toLowerCase() : entry.name
      const artworkPath = findFolderArtwork(fullPath)
      const artworkTracks = [...(artworkByChild.get(childKey)?.values() || [])].slice(0, 4)
      return {
        name: entry.name,
        path: childRelative,
        trackCount: folderTrackCounts.get(childKey) || 0,
        artwork_path: artworkPath,
        artwork_tracks: artworkTracks,
      }
    })
    .filter(folder => !folder.name.startsWith('.') && folder.trackCount > 0)
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

