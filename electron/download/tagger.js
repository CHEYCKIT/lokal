// Finishing touches on a downloaded file, written with node-taglib-sharp (pure
// JS, so it runs the same in Electron and under plain Node for the web server):
//   - lyrics: LRC/plain in the standard tag, Lokal's timings in LOKAL_LYRICS
//   - a square cover: YouTube thumbnails are 16:9 video frames, so the art is
//     cropped from the middle (the album art sits there on "Topic" uploads)
//   - "Artist - Song" titles lose the repeated artist
// Every step is best-effort: a file that can't be tagged is still a download.

const { PRIVATE_TAG } = require('../lyrics/embedded')

let taglib = null
function lib() {
  if (taglib === null) {
    try { taglib = require('node-taglib-sharp') } catch { taglib = false }
  }
  return taglib || null
}

let sharpLib = null
function sharp() {
  if (sharpLib === null) {
    try { sharpLib = require('sharp') } catch { sharpLib = false }
  }
  return sharpLib || null
}

const WIDE = 1.15

/** What the file says about itself, for the lyrics lookup. */
function readInfo(filePath) {
  const T = lib()
  if (!T) return null
  let file
  try {
    file = T.File.createFromPath(filePath)
    const tag = file.tag
    const artist = tag.performers?.[0] || tag.albumArtists?.[0] || ''
    const duration = file.properties?.durationMilliseconds ? file.properties.durationMilliseconds / 1000 : 0
    return {
      title: tag.title || '',
      artist: tag.performers?.length ? tag.performers.join(', ') : artist,
      album: tag.album || '',
      duration,
      hasLyrics: !!(tag.lyrics && tag.lyrics.trim()),
    }
  } catch {
    return null
  } finally {
    try { file?.dispose() } catch {}
  }
}

function setPrivateField(T, file, name, value) {
  const types = T.TagTypes
  const path = String(file.name || '').toLowerCase()
  if (/\.mp3$/.test(path)) {
    const id3 = file.getTag(types.Id3v2, true)
    if (!id3) return false
    for (const frame of id3.getFramesByClassType?.(T.Id3v2FrameClassType.UserTextInformationFrame) || []) {
      if (frame.description === name) id3.removeFrame(frame)
    }
    if (value == null) return true
    const frame = T.Id3v2UserTextInformationFrame.fromDescription(name)
    frame.text = [value]
    id3.addFrame(frame)
    return true
  }
  if (/\.(m4a|mp4|aac|alac)$/.test(path)) {
    const apple = file.getTag(types.Apple, true)
    if (!apple) return false
    apple.setItunesStrings('com.apple.iTunes', name, value == null ? undefined : value)
    return true
  }
  const xiph = file.getTag(types.Xiph, true)
  if (!xiph) return false
  xiph.setFieldAsStrings(name, ...(value == null ? [] : [value]))
  return true
}

async function squareCover(T, file) {
  const s = sharp()
  const picture = file.tag.pictures?.[0]
  if (!s || !picture?.data) return false
  const bytes = Buffer.from(picture.data.toByteArray ? picture.data.toByteArray() : picture.data)
  const meta = await s(bytes).metadata()
  if (!meta.width || !meta.height || meta.width / meta.height < WIDE) return false
  const side = Math.min(meta.width, meta.height)
  const left = Math.floor((meta.width - side) / 2)
  const top = Math.floor((meta.height - side) / 2)
  const jpeg = await s(bytes).extract({ left, top, width: side, height: side }).jpeg({ quality: 92 }).toBuffer()
  const cover = T.Picture.fromData(T.ByteVector.fromByteArray(jpeg))
  cover.type = T.PictureType.FrontCover
  cover.mimeType = 'image/jpeg'
  cover.description = 'Cover'
  file.tag.pictures = [cover]
  return true
}

function stripArtistPrefix(title, artist) {
  const t = String(title || '')
  const a = String(artist || '').split(/,|&| feat\.? | ft\.? /i)[0].trim()
  if (!t || !a) return t
  const prefix = new RegExp(`^${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+[-–—]\\s+`, 'i')
  const stripped = t.replace(prefix, '').trim()
  return stripped || t
}

/**
 * @param changes { lyrics?: string|null, privateLyrics?: string|null, squareCover?: bool, cleanTitle?: bool }
 * @returns { lyrics: bool, cover: bool, title: string|null } -- what was actually changed
 */
async function applyTags(filePath, changes = {}) {
  const T = lib()
  const done = { lyrics: false, cover: false, title: null }
  if (!T) return done
  let file
  try {
    file = T.File.createFromPath(filePath)
    const hadId3v1 = typeof file.tagTypesOnDisk === 'number' && (file.tagTypesOnDisk & T.TagTypes.Id3v1) !== 0
    let dirty = false

    if (changes.lyrics) {
      file.tag.lyrics = changes.lyrics
      if (changes.privateLyrics) setPrivateField(T, file, PRIVATE_TAG, changes.privateLyrics)
      done.lyrics = true
      dirty = true
    }
    if (changes.squareCover) {
      try { if (await squareCover(T, file)) { done.cover = true; dirty = true } } catch {}
    }
    if (changes.title || changes.artist) {
      if (changes.title && changes.title !== file.tag.title) { file.tag.title = changes.title; done.title = changes.title }
      if (changes.artist) { file.tag.performers = [changes.artist]; done.artist = changes.artist }
      dirty = true
    }
    if (changes.cleanTitle) {
      const artist = file.tag.performers?.[0] || ''
      const title = file.tag.title || ''
      const next = stripArtistPrefix(title, artist)
      if (next && next !== title) { file.tag.title = next; done.title = next; dirty = true }
    }

    if (dirty) {
      // taglib adds an ID3v1 tag to MP3s that never had one; don't.
      if (!hadId3v1 && /\.mp3$/i.test(filePath)) { try { file.removeTags(T.TagTypes.Id3v1) } catch {} }
      file.save()
    }
  } catch {
    return { lyrics: false, cover: false, title: null }
  } finally {
    try { file?.dispose() } catch {}
  }
  return done
}

/**
 * A small square picture of the file's cover, as a data: URL, for the
 * download list (works the same on desktop and in a browser). Null when the
 * file has no cover.
 */
async function coverThumbnail(filePath, size = 96) {
  const T = lib()
  const s = sharp()
  if (!T || !s) return null
  let file
  let bytes = null
  try {
    file = T.File.createFromPath(filePath)
    const picture = file.tag.pictures?.[0]
    if (picture?.data) bytes = Buffer.from(picture.data.toByteArray ? picture.data.toByteArray() : picture.data)
  } catch { return null } finally {
    try { file?.dispose() } catch {}
  }
  if (!bytes?.length) return null
  try {
    const jpeg = await s(bytes).resize(size, size, { fit: 'cover' }).jpeg({ quality: 78 }).toBuffer()
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  } catch { return null }
}

module.exports = { readInfo, applyTags, stripArtistPrefix, coverThumbnail }
