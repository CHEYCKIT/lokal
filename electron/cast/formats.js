// What a Cast device can play as it is, and what to make of what it can't.
//
// Google's list (developers.google.com/cast/docs/media): MP3, AAC (in MP4),
// Opus and Vorbis (in Ogg or WebM), WAV (LPCM) and FLAC up to 96 kHz /
// 24-bit. Everything else is converted once into the cache: lossless to FLAC
// within the ceiling (nothing audible lost; 176.4/192 kHz and DSD come down
// to 88.2/96 kHz), lossy codecs it can't read (WMA, AC-3...) to AAC.
//
// The ceiling is Settings → Playback → Casting → Quality: "max" (24-bit /
// 96 kHz) or "standard" (16-bit / 48 kHz, for a weak Wi-Fi).

const path = require('path')

const CEILINGS = {
  max: { rate: 96000, depth: 24 },
  standard: { rate: 48000, depth: 16 },
}

const MIME = {
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.wav': 'audio/wav',
}

const LOSSLESS = /^(?:ALAC|APE|Monkey|WavPack|TTA|DSD|DST|MLP|TrueHD|FLAC|PCM|WAVE?|AIFF)/i

/** The codec family from music-metadata's codec name (or a container). */
function family(codec) {
  const name = String(codec || '').trim()
  if (/^FLAC/i.test(name)) return 'flac'
  if (/Layer\s*3|^MP3$/i.test(name)) return 'mp3'
  if (/^(?:MPEG-4\/)?AAC|^mp4a/i.test(name)) return 'aac'
  if (/^Opus/i.test(name)) return 'opus'
  if (/^Vorbis/i.test(name)) return 'vorbis'
  if (/^(?:PCM|WAVE?)/i.test(name)) return 'pcm'
  return name ? 'other' : 'unknown'
}

/** Containers each family plays from, by extension. */
const CONTAINERS = {
  flac: ['.flac'],
  mp3: ['.mp3'],
  aac: ['.m4a', '.mp4', '.aac'],
  opus: ['.ogg', '.opus', '.webm', '.oga'],
  vorbis: ['.ogg', '.oga', '.webm'],
  pcm: ['.wav'],
}

/** The rate a too-high one comes down to: the ceiling's own family (44.1 or 48 kHz multiples). */
function targetRate(rate, ceiling) {
  if (!rate || rate <= ceiling.rate) return rate || null
  const of441 = rate % 44100 === 0 || rate % 11025 === 0 || rate >= 2822400 // DSD is a 44.1 kHz multiple
  if (of441) return ceiling.rate >= 88200 ? 88200 : 44100
  return ceiling.rate
}

/**
 * How a library file goes to the TV.
 * @param info { file, codec, sampleRate, bitDepth, lossless }
 * @returns { action: 'direct', mime } or { action: 'convert', to: 'flac'|'aac', rate, depth, ext, mime }
 */
function planFile(info, quality = 'max') {
  const ceiling = CEILINGS[quality] || CEILINGS.max
  const ext = path.extname(String(info.file || '')).toLowerCase()
  const kind = family(info.codec)
  const rate = Number(info.sampleRate) || 0
  const depth = Number(info.bitDepth) || 0
  const lossless = info.lossless != null ? !!Number(info.lossless) : LOSSLESS.test(String(info.codec || ''))
  const fits = (!rate || rate <= ceiling.rate) && (!depth || depth <= ceiling.depth)
  const containerOk = CONTAINERS[kind]?.includes(ext)
  if (containerOk && (kind === 'flac' || kind === 'pcm' ? fits : true)) return { action: 'direct', mime: MIME[ext] || 'audio/mpeg' }
  if (lossless || kind === 'flac' || kind === 'pcm') {
    return {
      action: 'convert', to: 'flac', ext: '.flac', mime: 'audio/flac',
      rate: targetRate(rate, ceiling),
      depth: depth && depth <= 16 ? 16 : Math.min(ceiling.depth, 24),
    }
  }
  return { action: 'convert', to: 'aac', ext: '.m4a', mime: 'audio/mp4', rate: rate && rate > 48000 ? 48000 : null, depth: null }
}

/** The ffmpeg arguments for a planned conversion (the audio only: covers aren't needed on the TV). */
function convertArgs(src, dest, plan, { headers = null } = {}) {
  const input = headers && Object.keys(headers).length
    ? ['-headers', Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n', '-i', src]
    : ['-i', src]
  const rate = plan.rate ? ['-ar', String(plan.rate)] : []
  const codec = plan.to === 'flac'
    ? ['-c:a', 'flac', '-compression_level', '5', ...(plan.depth > 16 ? ['-sample_fmt', 's32', '-bits_per_raw_sample', '24'] : ['-sample_fmt', 's16'])]
    : ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart']
  return ['-hide_banner', '-nostdin', '-y', ...input, '-map', '0:a:0', '-vn', ...rate, ...codec, dest]
}

/** A streamed song's type, as the TV is told it. */
function streamMime(mime) {
  const type = String(mime || '').split(';')[0].trim().toLowerCase()
  if (!type || type === 'audio/*' || type === 'application/octet-stream') return 'audio/mp4'
  return type
}

module.exports = { planFile, convertArgs, family, targetRate, streamMime, CEILINGS, MIME }
