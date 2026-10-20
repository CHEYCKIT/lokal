// Song covers in the covers cache (data/artwork) are small: a 150x150 WebP
// made from the picture inside the file. Lists, the player bar and the side
// panel show it; the full-size picture is read back out of the file only
// when it's shown big (see fullCover.js). Without sharp the picture is kept
// as it is, like before.

const fs = require('fs')
const path = require('path')

const THUMB_SIZE = 150
const THUMB_QUALITY = 80

let sharpLib = null
function sharp() {
  if (sharpLib === null) {
    try { sharpLib = require('sharp'); sharpLib.cache(false) } catch { sharpLib = false }
  }
  return sharpLib || null
}

/** The picture as a 150x150 WebP (cropped to a square from the middle), or null if it can't be made. */
async function makeThumb(bytes) {
  const s = sharp()
  if (!s || !bytes?.length) return null
  try {
    return await s(Buffer.from(bytes), { failOn: 'none' })
      .rotate()
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer()
  } catch { return null }
}

/**
 * Writes the cover of a song into the cache as `<base>.webp` (the thumbnail),
 * or `<base>.jpg` with the picture as it is when no thumbnail can be made.
 * An existing file is kept (the name carries the file's version). -> its path.
 */
async function writeCover(dir, base, bytes) {
  const thumbPath = path.join(dir, `${base}.webp`)
  if (fs.existsSync(thumbPath)) return thumbPath
  fs.mkdirSync(dir, { recursive: true })
  const thumb = await makeThumb(bytes)
  if (thumb) {
    fs.writeFileSync(thumbPath, thumb)
    return thumbPath
  }
  const rawPath = path.join(dir, `${base}.jpg`)
  if (!fs.existsSync(rawPath)) fs.writeFileSync(rawPath, bytes)
  return rawPath
}

module.exports = { THUMB_SIZE, makeThumb, writeCover }
