'use strict'

/**
 * What a source says of a stream's quality ("FLAC 16/44.1", "MP3 320"):
 * { codec, lossless, bit_depth, sample_rate, bitrate } (nulls when unknown).
 */
function streamQuality(format) {
  const text = String(format || '').trim()
  const out = { codec: null, lossless: null, bit_depth: null, sample_rate: null, bitrate: null }
  if (!text) return out
  // Tidal Mornye often advertises "24bit" or "16bit/44.1kHz" rather
  // than prefixing a codec. Preserve the catalogue tier but never infer an
  // unreported sample rate or label it as measured output.
  const codec = text.match(/^(flac|alac|wav|aiff|mp3|aac|opus|ogg|vorbis|m4a)\b/i)?.[1]?.toLowerCase()
  if (codec) {
    out.codec = codec
    out.lossless = ['flac', 'alac', 'wav', 'aiff'].includes(codec) ? 1 : 0
  }
  const depth = text.match(/\b(16|24|32)\s*(?:-?\s*bits?)?\b/i)
  if (depth && out.lossless !== 0) {
    out.lossless = 1
    out.bit_depth = Number(depth[1])
  }
  // A full 44100Hz must never match the first three digits as 441kHz.
  // Keep the unit when provided; older "FLAC 16/44.1" means kHz.
  const pairedRate = text.match(/\b(?:16|24|32)\s*(?:-?\s*bits?)?\s*[-/·,]\s*(\d+(?:\.\d+)?)\s*(k(?:hz)?|hz)?\b/i)
  const explicitRate = text.match(/\b(\d{2,6}(?:\.\d+)?)\s*(k(?:hz)?|hz)\b/i)
  const rate = pairedRate || explicitRate
  if (out.lossless === 1 && rate) {
    const value = Number(rate[1])
    const unit = (rate[2] || '').toLowerCase()
    const hz = unit === 'hz' || (!unit && value > 1000) ? value : value * 1000
    if (Number.isFinite(hz) && hz >= 8000 && hz <= 384000) out.sample_rate = Math.round(hz)
  }
  if (out.lossless === 0) {
    const kbps = Number(text.match(/(\d{2,4})\s*(?:kbps|k)?\s*$/i)?.[1])
    if (kbps >= 32 && kbps <= 2000) out.bitrate = kbps
  }
  return out
}

module.exports = { streamQuality }
