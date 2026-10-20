// Full-size artwork for large views. Ordinary UI uses a cached 150x150 WebP;
// the original is read from the source audio only when a large image is requested.
const fs = require('fs')
const path = require('path')

function mimeOf(bytes, reported = '') {
  const value = String(reported || '').toLowerCase()
  if (value.startsWith('image/')) return value
  if (bytes?.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes?.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes?.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes?.length >= 4 && bytes.toString('latin1', 0, 4).startsWith('GIF8')) return 'image/gif'
  return 'application/octet-stream'
}
const isLocalFile = filePath => {
  if (!filePath || typeof filePath !== 'string' || /^(ghost|https?|radio):/i.test(filePath)) return false
  try { return path.isAbsolute(filePath) && fs.statSync(filePath).isFile() } catch { return false }
}
function within(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}
function allowedArtworkPath(db, filePath) {
  let realFile
  try { realFile = fs.realpathSync(filePath) } catch { return false }
  let storageDir = ''
  try { storageDir = require('../ipc/db').getStorageDir() || '' } catch {}
  const roots = []
  if (storageDir) roots.push(path.join(storageDir, 'artwork'))
  try {
    const plural = db.prepare("SELECT value FROM settings WHERE key = 'music_folders'").get()?.value
    const parsed = JSON.parse(plural || 'null')
    if (Array.isArray(parsed)) roots.push(...parsed.filter(value => typeof value === 'string' && value.trim()))
  } catch {}
  try {
    const single = db.prepare("SELECT value FROM settings WHERE key = 'music_folder'").get()?.value
    if (single) roots.push(single)
  } catch {}
  return roots.some(value => {
    try { return within(fs.realpathSync(path.resolve(value)), realFile) } catch { return false }
  })
}

/** The front-cover image embedded in a local audio file, or null. */
async function filePicture(filePath) {
  if (!isLocalFile(filePath)) return null
  try {
    const meta = await require('../musicMetadata').parseFile(filePath, { duration: false, skipCovers: false })
    const picture = meta?.common?.picture?.[0]
    if (!picture?.data?.length) return null
    const bytes = Buffer.from(picture.data)
    return { bytes, mime: mimeOf(bytes, picture.format) }
  } catch { return null }
}

/** Full cover for a trusted track: embedded original for a generated thumbnail, else the stored artwork file. */
async function fullCoverForTrack(db, trackId) {
  let track
  try { track = db.prepare('SELECT file_path, artwork_path FROM tracks WHERE id = ?').get(String(trackId || '')) } catch { return null }
  if (!track?.artwork_path) return null
  const filePath = path.resolve(String(track.artwork_path))
  if (!fs.existsSync(filePath) || !allowedArtworkPath(db, filePath)) return null
  let storageDir = ''
  try { storageDir = require('../ipc/db').getStorageDir() || '' } catch {}
  const artworkDir = storageDir ? path.resolve(storageDir, 'artwork') : null
  const isCacheThumbnail = artworkDir && within(artworkDir, filePath) && path.extname(filePath).toLowerCase() === '.webp'
  if (isCacheThumbnail) {
    const embedded = await filePicture(track.file_path)
    if (embedded) return embedded
  }
  try {
    const bytes = fs.readFileSync(filePath)
    return bytes.length ? { bytes, mime: mimeOf(bytes, path.extname(filePath).toLowerCase() === '.webp' ? 'image/webp' : '') } : null
  } catch { return null }
}

module.exports = { mimeOf, filePicture, fullCoverForTrack, allowedArtworkPath }
