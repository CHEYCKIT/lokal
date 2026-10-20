// SYLT frames (an MP3's synced lyrics) in a form AIMP reads.
//
// AIMP looks for a UTF-16 entry's 00 00 terminator byte by byte instead of
// two bytes at a time, so any two zero bytes it meets end the line there --
// even straddling two characters -- and every line after it turns into CJK
// with nonsense times:
//   - little-endian (the usual UTF-16) puts a Latin letter as "72 00", so a
//     line ending in one ("Bye", "Love,") breaks;
//   - big-endian puts Hangul 가 (U+AC00) as "AC 00", so "누가" breaks, and so
//     does 가 followed by a space or a Latin letter.
// So each frame is written the first way that reads back right when scanned
// AIMP's way: Latin-1 (one-byte terminator) when every line fits in it, else
// UTF-16 little-endian, else big-endian. When neither works the SYLT frame is
// left out: AIMP then reads the same LRC from the USLT frame.
// taglib only writes little-endian, and re-renders every frame it parsed on
// each save, so every place that saves an MP3 calls this right before.

const isLatin1 = (text) => /^[\u0000-ÿ]*$/.test(String(text || ''))

/** BOM + text + 00 00, little- or big-endian. */
function utf16(text, bigEndian) {
  const bytes = Buffer.from(String(text || ''), 'utf16le')
  if (bigEndian) for (let i = 0; i < bytes.length; i += 2) { const low = bytes[i]; bytes[i] = bytes[i + 1]; bytes[i + 1] = low }
  return Buffer.concat([Buffer.from(bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]), bytes, Buffer.from([0, 0])])
}

/** True when the first two zero bytes in an encoded string are its own terminator. */
function aimpReadsString(encoded) {
  for (let i = 0; i + 1 < encoded.length; i++) {
    if (encoded[i] === 0 && encoded[i + 1] === 0) return i === encoded.length - 2
  }
  return false
}

const readsBack = (strings, bigEndian) => strings.every(text => aimpReadsString(utf16(text, bigEndian)))

/** The frame's fields as ID3v2 SYLT bytes, text in UTF-16 big-endian. */
function renderBigEndian(frame) {
  const language = String(frame.language || 'eng').padEnd(3, ' ').slice(0, 3)
  const parts = [Buffer.from([1]), Buffer.from(language, 'latin1'), Buffer.from([frame.format, frame.textType]), utf16(frame.description, true)]
  for (const line of frame.text || []) {
    const time = Buffer.alloc(4)
    time.writeUInt32BE(Math.max(0, Math.min(0xffffffff, Math.round(Number(line.time) || 0))))
    parts.push(utf16(line.text, true), time)
  }
  return Buffer.concat(parts)
}

/** Rewrites the file's SYLT frames AIMP-safe; call right before file.save(). */
function aimpSafeSylt(T, file) {
  if (!/\.mp3$/i.test(String(file?.name || ''))) return
  try {
    const id3 = file.getTag(T.TagTypes.Id3v2, false)
    if (!id3) return
    for (const frame of id3.getFramesByClassType(T.Id3v2FrameClassType.SynchronizedLyricsFrame) || []) {
      const strings = [frame.description, ...(frame.text || []).map(line => line.text)]
      if (strings.every(isLatin1)) { frame.textEncoding = T.StringType.Latin1; continue }
      if (readsBack(strings, false)) { frame.textEncoding = T.StringType.UTF16; continue }
      id3.removeFrame(frame)
      if (readsBack(strings, true)) {
        id3.addFrame(T.Id3v2UnknownFrame.fromData(T.Id3v2FrameIdentifiers.SYLT, T.ByteVector.fromByteArray(renderBigEndian(frame))))
      }
    }
  } catch { /* leave the frames as taglib has them */ }
}

/** Whether an MP3's SYLT frame (raw frame body) is one AIMP misreads. */
function isAimpBrokenSylt(body) {
  if (!body || body.length < 8 || body[0] !== 1) return false
  // After the 6-byte header: the description, then entries of BOM, text,
  // 00 00 (on a character boundary) and a 4-byte time.
  let p = 6
  const readString = () => {
    const start = p
    while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2
    p += 2
    return body.subarray(start, Math.min(p, body.length))
  }
  if (!aimpReadsString(readString())) return true
  while (p < body.length) {
    if (!aimpReadsString(readString())) return true
    p += 4
  }
  return false
}

/** True when the MP3's ID3v2 tag has a SYLT frame AIMP misreads. Reads only the tag. */
function hasAimpBrokenSylt(filePath) {
  const fs = require('fs')
  let fd
  try {
    fd = fs.openSync(filePath, 'r')
    const header = Buffer.alloc(10)
    if (fs.readSync(fd, header, 0, 10, 0) < 10 || header.toString('latin1', 0, 3) !== 'ID3') return false
    const version = header[3]
    // v2.2, unsynchronised or extended-header tags: not what Lokal writes.
    if (version < 3 || (header[5] & 0xc0)) return false
    const size = ((header[6] & 127) << 21) | ((header[7] & 127) << 14) | ((header[8] & 127) << 7) | (header[9] & 127)
    const tag = Buffer.alloc(size)
    fs.readSync(fd, tag, 0, size, 10)
    let p = 0
    while (p + 10 <= tag.length) {
      const id = tag.toString('latin1', p, p + 4)
      if (!/^[A-Z0-9]{4}$/.test(id)) break
      const n = version === 4
        ? ((tag[p + 4] & 127) << 21) | ((tag[p + 5] & 127) << 14) | ((tag[p + 6] & 127) << 7) | (tag[p + 7] & 127)
        : tag.readUInt32BE(p + 4)
      if (id === 'SYLT' && isAimpBrokenSylt(tag.subarray(p + 10, p + 10 + n))) return true
      p += 10 + n
    }
    return false
  } catch { return false } finally { if (fd != null) try { fs.closeSync(fd) } catch {} }
}

module.exports = { aimpSafeSylt, isAimpBrokenSylt, hasAimpBrokenSylt, renderBigEndian }
