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

function getLibraryFolders(db, relativePath = '') {
  const configuredRoot = db.prepare("SELECT value FROM settings WHERE key = 'music_folder'").get()?.value
  if (!configuredRoot) {
    return { available: false, error: 'No music folder selected', rootName: '', relativePath: '', folders: [], tracks: [] }
  }

  const rootPath = path.resolve(String(configuredRoot))
  const requestedPath = typeof relativePath === 'string' ? relativePath.slice(0, 4096) : ''
  const targetPath = path.resolve(rootPath, requestedPath || '.')
  const relative = path.relative(rootPath, targetPath)
  const normalizedRelative = relative && relative !== '.' ? relative.split(path.sep).join('/') : ''
  const rootName = path.basename(rootPath) || rootPath
  const empty = (error, notFound = false) => ({
    available: true, error, notFound, rootName, relativePath: normalizedRelative, folders: [], tracks: [],
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

  const folders = entries
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const fullPath = path.join(targetPath, entry.name)
      const childRelative = path.relative(rootPath, fullPath).split(path.sep).join('/')
      return { name: entry.name, path: childRelative }
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

  return { available: true, rootName, relativePath: normalizedRelative, folders, tracks, trackCount: tracks.length }
}

module.exports = { findFolderArtwork, getLibraryFolders }
