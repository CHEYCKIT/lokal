// Update the cover in the source audio file, not only Lokal's artwork cache.
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

function imageBuffer(imageData) {
  if (Buffer.isBuffer(imageData)) return imageData
  if (typeof imageData !== 'string') throw new Error('No image data provided')
  const match = imageData.match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i)
  if (!match) throw new Error('Invalid image data')
  const bytes = Buffer.from(match[1], 'base64')
  if (!bytes.length) throw new Error('The selected image is empty')
  return bytes
}

/** Validate and normalize the selected image once for cache and embedded tags. */
async function normalizeArtwork(imageData) {
  const input = imageBuffer(imageData)
  try {
    return await sharp(input, { failOn: 'error', limitInputPixels: 40000000 })
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer()
  } catch (error) {
    throw new Error(`Could not read the selected artwork: ${error?.message || 'invalid image'}`)
  }
}

/** Replace only the front-cover image, preserving other embedded picture types. */
function writeEmbeddedArtwork(filePath, jpegBytes) {
  if (!filePath || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) throw new Error('Audio file not found')
  const T = require('node-taglib-sharp')
  let file
  try {
    file = T.File.createFromPath(filePath)
    // An MP3 without tags has no generic writable tag, so explicitly create
    // ID3v2 before writing its APIC/front-cover frame.
    const tag = /\.mp3$/i.test(filePath) ? file.getTag(T.TagTypes.Id3v2, true) : file.tag
    if (!tag) throw new Error('This audio format does not support embedded artwork')
    const current = Array.isArray(tag.pictures) ? tag.pictures : []
    const cover = T.Picture.fromFullData(
      T.ByteVector.fromByteArray(Buffer.from(jpegBytes)),
      T.PictureType.FrontCover,
      'image/jpeg',
      ''
    )
    cover.filename = 'cover.jpg'
    cover.description = ''
    tag.pictures = [
      ...current.filter(picture => picture && picture.type !== T.PictureType.FrontCover),
      cover,
    ]
    const stored = Array.isArray(tag.pictures) ? tag.pictures : []
    if (!stored.some(picture => picture && picture.type === T.PictureType.FrontCover)) {
      throw new Error('This audio format does not support embedded artwork')
    }
    file.save()
  } catch (error) {
    const busy = /EBUSY|EPERM|EACCES/i.test(String(error?.code || error?.message || ''))
    throw new Error(busy
      ? 'The audio file is in use or read-only'
      : `Could not embed artwork in the audio file: ${error?.message || String(error)}`)
  } finally {
    try { file?.dispose() } catch {}
  }
}

module.exports = { normalizeArtwork, writeEmbeddedArtwork }
