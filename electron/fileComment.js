// The comment tag inside the audio file -- written when it's changed in the
// tag editor. Only the ordinary comment is replaced (ID3v2: the COMM frame
// without a description); frames with one stay as they are -- a player's own
// (iTunNORM...) or a downloader's ("n": "Converted by ...").

const fs = require('fs')

let taglib = null
function lib() {
  if (taglib === null) {
    try { taglib = require('node-taglib-sharp') } catch { taglib = false }
    // Genres as written ("Synthwave, Electronic"), not as ID3v1 numbers: an
    // ID3v2.3 "(52)Synthwave" reads back with Electronic first, the main genre.
    if (taglib) { try { taglib.Id3v2Settings.useNumericGenres = false } catch {} }
  }
  return taglib || null
}

function writeId3(T, file, text) {
  const id3 = file.getTag(T.TagTypes.Id3v2, true)
  const frames = id3.getFramesByClassType(T.Id3v2FrameClassType.CommentsFrame) || []
  const own = frames.filter(frame => !String(frame.description || '').trim())
  const model = own[0] || null
  const language = model?.language && model.language.length === 3 ? model.language : 'eng'
  for (const frame of own) id3.removeFrame(frame)
  if (!text) return
  const frame = T.Id3v2CommentsFrame.fromDescription('', language, T.StringType.UTF16)
  frame.text = text
  id3.addFrame(frame)
}

/** Empty text removes the comment. */
function writeFileComment(filePath, text) {
  const T = lib()
  if (!T) throw new Error('Tag writer unavailable')
  if (!filePath || !fs.existsSync(filePath)) throw new Error('File not found')
  const clean = String(text || '').replace(/\r\n?/g, '\n').trim()
  let file
  try {
    file = T.File.createFromPath(filePath)
    const mp3 = /\.mp3$/i.test(filePath)
    const hadId3v1 = typeof file.tagTypesOnDisk === 'number' && (file.tagTypesOnDisk & T.TagTypes.Id3v1) !== 0
    if (mp3) writeId3(T, file, clean)
    else file.tag.comment = clean || undefined
    // taglib adds an ID3v1 tag to MP3s that never had one; don't.
    if (mp3 && !hadId3v1) { try { file.removeTags(T.TagTypes.Id3v1) } catch {} }
    file.save()
  } catch (e) {
    const busy = /EBUSY|EPERM|EACCES/i.test(String(e?.code || e?.message || ''))
    throw new Error(busy ? 'The file is in use or read-only' : (e?.message || String(e)))
  } finally {
    try { file?.dispose() } catch {}
  }
  return clean
}

module.exports = { writeFileComment }

/**
 * The genre tag, one value per genre (ID3v2.4 TCON holds several; the tag
 * editor's genres). An empty list removes it.
 */
function writeFileGenres(filePath, genres) {
  const T = lib()
  if (!T) throw new Error('Tag writer unavailable')
  if (!filePath || !fs.existsSync(filePath)) throw new Error('File not found')
  const list = (Array.isArray(genres) ? genres : []).map(value => String(value || '').trim()).filter(Boolean)
  let file
  try {
    file = T.File.createFromPath(filePath)
    const mp3 = /\.mp3$/i.test(filePath)
    const hadId3v1 = typeof file.tagTypesOnDisk === 'number' && (file.tagTypesOnDisk & T.TagTypes.Id3v1) !== 0
    file.tag.genres = list
    if (mp3 && !hadId3v1) { try { file.removeTags(T.TagTypes.Id3v1) } catch {} }
    file.save()
  } catch (e) {
    const busy = /EBUSY|EPERM|EACCES/i.test(String(e?.code || e?.message || ''))
    throw new Error(busy ? 'The file is in use or read-only' : (e?.message || String(e)))
  } finally {
    try { file?.dispose() } catch {}
  }
}

module.exports.writeFileGenres = writeFileGenres

// ------------------------------------------------------------- the tag editor
//
// What Edit Track saves goes into the file's tags as well as the library, so a
// rescan reads the same song back (it used to keep only the comment and the
// genres: a changed title or artist came back as before on the next scan).

const text = value => String(value ?? '').trim()
const number = value => {
  const n = parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}
// Each field: how the editor's value reaches the file's tag.
const TAG_FIELDS = {
  title: (tag, value) => { tag.title = text(value) || undefined },
  artist: (tag, value) => { tag.performers = text(value) ? [text(value)] : [] },
  album: (tag, value) => { tag.album = text(value) || undefined },
  album_artist: (tag, value) => { tag.albumArtists = text(value) ? [text(value)] : [] },
  track_num: (tag, value) => { tag.track = number(value) },
  year: (tag, value) => { tag.year = number(value) },
  record_label: (tag, value) => { tag.publisher = text(value) || undefined },
  genres: (tag, value) => {
    tag.genres = (Array.isArray(value) ? value : String(value ?? '').split(',')).map(text).filter(Boolean)
  },
}

/** The fields of a tag editor save that live in the file (comment included). */
function fileTagEdits(data = {}) {
  const edits = {}
  for (const field of [...Object.keys(TAG_FIELDS), 'comment']) {
    if (data[field] !== undefined) edits[field] = data[field]
  }
  return edits
}

/**
 * Writes the tag editor's fields (see TAG_FIELDS, and `comment`) into the
 * file in one save. Fields left out stay as they are; an empty one is removed.
 */
function writeFileTags(filePath, edits = {}) {
  const fields = Object.keys(fileTagEdits(edits))
  if (!fields.length) return
  const T = lib()
  if (!T) throw new Error('Tag writer unavailable')
  if (!filePath || !fs.existsSync(filePath)) throw new Error('File not found')
  let file
  try {
    file = T.File.createFromPath(filePath)
    const mp3 = /\.mp3$/i.test(filePath)
    const hadId3v1 = typeof file.tagTypesOnDisk === 'number' && (file.tagTypesOnDisk & T.TagTypes.Id3v1) !== 0
    // An MP3 without tags gets an ID3v2 one (file.tag alone has nowhere to write).
    const id3 = mp3 ? file.getTag(T.TagTypes.Id3v2, true) : null
    // Several genres need ID3v2.4: v2.3 has no list, and "A;B" reads back as one genre.
    const genreCount = String(edits.genres ?? '').split(',').filter(part => part.trim()).length
    if (id3 && fields.includes('genres') && genreCount > 1 && id3.version < 4) id3.version = 4
    for (const field of fields) {
      if (field === 'comment') {
        const clean = String(edits.comment || '').replace(/\r\n?/g, '\n').trim()
        if (mp3) writeId3(T, file, clean)
        else file.tag.comment = clean || undefined
      } else {
        TAG_FIELDS[field](file.tag, edits[field])
      }
    }
    if (mp3 && !hadId3v1) { try { file.removeTags(T.TagTypes.Id3v1) } catch {} }
    file.save()
  } catch (e) {
    const busy = /EBUSY|EPERM|EACCES/i.test(String(e?.code || e?.message || ''))
    throw new Error(busy ? 'The file is in use or read-only' : (e?.message || String(e)))
  } finally {
    try { file?.dispose() } catch {}
  }
}

module.exports.fileTagEdits = fileTagEdits
module.exports.writeFileTags = writeFileTags
