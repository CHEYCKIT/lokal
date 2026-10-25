'use strict'

// Morneye's downloader is the transport; only *unprocessed* single-file
// transfers with a complete, decodable initialization header may begin before
// final verification. Segment assembly, DRM and conversion retain full-file
// preparation.
function flacHeader(prefix) {
  if (!Buffer.isBuffer(prefix) || prefix.length < 42 ||
      prefix.toString('ascii', 0, 4) !== 'fLaC' ||
      (prefix[4] & 0x7f) !== 0 ||
      prefix.readUIntBE(5, 3) !== 34) return false
  const rate = (prefix[18] << 12) | (prefix[19] << 4) | (prefix[20] >> 4)
  const bits = (((prefix[20] & 1) << 4) | (prefix[21] >> 4)) + 1
  return rate >= 8000 && rate <= 768000 && bits >= 8 && bits <= 32
}

// Parse bounded ISO-BMFF boxes. "mp4a" in incidental text is NOT a valid
// sample description; this deliberately fails closed on incomplete/extended
// boxes, non-audio tracks, encryption, or fragmented recordings.
function boxes(data, start, end) {
  if (end > data.length || start > end) return null
  const result = []
  let at = start
  while (at < end) {
    if (at + 8 > end) return null
    const size = data.readUInt32BE(at)
    if (size < 8 || size > end - at) return null
    result.push({ type: data.toString('ascii', at + 4, at + 8),
      start: at, end: at + size })
    at += size
  }
  return result
}
function nested(data, parent) {
  return boxes(data, parent.start + 8, parent.end)
}
function child(data, parent, type) {
  return nested(data, parent)?.find(box => box.type === type)
}
function validSampleDescriptions(data, stsd) {
  // stsd: 8-byte header, version/flags, entry count, then sample entries.
  const begin = stsd.start + 8
  if (begin + 8 > stsd.end) return false
  const count = data.readUInt32BE(begin + 4)
  if (count < 1 || count > 64) return false
  const entries = boxes(data, begin + 8, stsd.end)
  if (!entries || entries.length !== count) return false
  return entries.some(entry => {
    if (!['mp4a', 'alac'].includes(entry.type) || entry.end - entry.start < 36)
      return false
    const base = entry.start
    const reference = data.readUInt16BE(base + 14)
    const channels = data.readUInt16BE(base + 24)
    const sampleSize = data.readUInt16BE(base + 26)
    return reference > 0 && channels >= 1 && channels <= 32 &&
      sampleSize >= 8 && sampleSize <= 32
  })
}
function validAudioMoov(data, moov) {
  const contents = nested(data, moov)
  if (!contents || contents.some(b => b.type === 'mvex' || b.type === 'pssh'))
    return false
  // Reject DRM and encrypted sample references anywhere inside the init box.
  const raw = data.subarray(moov.start + 8, moov.end)
  if (['sinf','schm','enca','encv','pssh','drms'].some(tag =>
    raw.includes(Buffer.from(tag)))) return false
  return contents.some(trak => {
    if (trak.type !== 'trak') return false
    const mdia = child(data, trak, 'mdia')
    if (!mdia) return false
    const handler = child(data, mdia, 'hdlr')
    if (!handler || handler.end - handler.start < 20 ||
        data.toString('ascii', handler.start + 16, handler.start + 20) !== 'soun')
      return false
    const minf = child(data, mdia, 'minf')
    const stbl = minf && child(data, minf, 'stbl')
    const stsd = stbl && child(data, stbl, 'stsd')
    return !!stsd && validSampleDescriptions(data, stsd)
  })
}

function fastStartMp4(prefix) {
  if (!Buffer.isBuffer(prefix) || prefix.length < 32) return false
  let offset = 0
  let sawFtyp = false
  while (offset + 8 <= prefix.length) {
    const length = prefix.readUInt32BE(offset)
    // End-of-file, 64-bit, partial and zero-sized boxes are never treated as
    // complete initialization. A moov after mdat is not fast-start.
    if (length < 8 || length > prefix.length - offset) return false
    const type = prefix.toString('ascii', offset + 4, offset + 8)
    if (!sawFtyp) {
      if (type !== 'ftyp') return false
      sawFtyp = true
    } else if (type === 'mdat' || type === 'moof') {
      return false
    } else if (type === 'moov') {
      return validAudioMoov(prefix, { start: offset, end: offset + length })
    }
    offset += length
  }
  return false
}

function progressiveMedia(prefix, filename) {
  const name = String(filename || '').toLowerCase()
  if (name.endsWith('.flac') && flacHeader(prefix))
    return { format: 'flac', mime: 'audio/flac' }
  if (/\.(?:m4a|mp4)$/.test(name) && fastStartMp4(prefix))
    return { format: 'm4a', mime: 'audio/mp4' }
  return null
}

module.exports = { flacHeader, fastStartMp4, progressiveMedia }
