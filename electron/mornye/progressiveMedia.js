'use strict'

// Only a verified, already-decodable *single-file* transfer may become a
// growing HTTP media response. The add-on still owns network authentication,
// decryption, segmented DASH assembly and final cache verification.
function flacHeader(prefix) {
  if (!Buffer.isBuffer(prefix) || prefix.length < 42 ||
      prefix.toString('ascii', 0, 4) !== 'fLaC' ||
      (prefix[4] & 0x7f) !== 0 ||
      prefix.readUIntBE(5, 3) !== 34) return false
  const rate = (prefix[18] << 12) | (prefix[19] << 4) | (prefix[20] >> 4)
  const bits = (((prefix[20] & 1) << 4) | (prefix[21] >> 4)) + 1
  return rate >= 8000 && rate <= 768000 && bits >= 8 && bits <= 32
}

function fastStartMp4(prefix) {
  if (!Buffer.isBuffer(prefix) || prefix.length < 32) return false
  let offset = 0
  let sawFtyp = false
  while (offset + 8 <= prefix.length) {
    const length = prefix.readUInt32BE(offset)
    // 64-bit, to-EOF, partial and zero-sized boxes are deliberately not
    // considered streamable. A delayed moov waits for completed preparation.
    if (length < 8 || length > prefix.length - offset) return false
    const type = prefix.toString('ascii', offset + 4, offset + 8)
    if (!sawFtyp) {
      if (type !== 'ftyp') return false
      sawFtyp = true
    } else if (type === 'mdat' || type === 'moof') {
      // No complete init box before the media payload.
      return false
    } else if (type === 'moov') {
      const moov = prefix.subarray(offset + 8, offset + length)
      const has = tag => moov.includes(Buffer.from(tag))
      // Fail closed for encrypted/protected or unsupported sample entries;
      // use Morneye's normal verified completion path instead.
      return (has('mp4a') || has('alac')) &&
        !['sinf','schm','enca','encv','pssh','drms'].some(has)
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
