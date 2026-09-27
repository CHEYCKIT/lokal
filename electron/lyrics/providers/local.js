// Lyrics that ship with the file itself:
//   - a sidecar next to the audio: song.ttml, song.elrc, song.lrc, song.txt
//   - lyrics embedded in the tags (ID3 USLT/SYLT, Vorbis LYRICS/UNSYNCEDLYRICS,
//     MP4 ©lyr...), which music-metadata surfaces as common.lyrics
//   - Lokal's own LOKAL_LYRICS tag, written when Lokal downloaded the file,
//     which keeps word timings, background vocals and duet sides
// Also reports the file's own ISRC tag, which lets the online sources match
// the exact recording without a fuzzy name search.

const fs = require('fs')
const path = require('path')
const { fromPrivateTag, PRIVATE_TAG } = require('../embedded')

let mm = null
function metadata() {
  if (mm === null) {
    try { mm = require('music-metadata') } catch { mm = false }
  }
  return mm || null
}

const SIDECARS = ['.ttml', '.elrc', '.lrc', '.txt']

function readSidecar(filePath) {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  for (const ext of SIDECARS) {
    const candidate = path.join(dir, base + ext)
    try {
      if (fs.existsSync(candidate)) {
        const text = fs.readFileSync(candidate, 'utf8')
        if (text.trim()) return text
      }
    } catch { /* unreadable, keep looking */ }
  }
  return null
}

const PRIVATE_IDS = new Set([`TXXX:${PRIVATE_TAG}`, PRIVATE_TAG, `----:com.apple.iTunes:${PRIVATE_TAG}`])
const LYRIC_IDS = new Set(['USLT', 'ULT', 'LYRICS', 'UNSYNCEDLYRICS', '©lyr', 'Lyrics'])

function nativeTags(meta) {
  return Object.values(meta?.native || {}).flat().filter(Boolean)
}

function tagText(value) {
  if (typeof value === 'string') return value
  if (value && typeof value.text === 'string') return value.text
  return ''
}

/** Lokal's own tag, parsed; null when the file doesn't have one. */
function privateLyrics(meta) {
  const values = nativeTags(meta)
    .filter(tag => PRIVATE_IDS.has(tag.id) || String(tag.id).toUpperCase() === PRIVATE_TAG)
    .map(tag => tagText(tag.value))
  for (const value of values) {
    const parsed = fromPrivateTag(value)
    if (parsed) return parsed
  }
  // ID3v2.3 readers split TXXX text on "/", so a lyric with a slash in it
  // ("AC/DC", "24/7") comes back in pieces.
  return values.length > 1 ? fromPrivateTag(values.join('/')) : null
}

function embeddedText(meta) {
  const lyrics = meta?.common?.lyrics
  let parts = (Array.isArray(lyrics) ? lyrics : lyrics ? [lyrics] : [])
    .map(tagText)
    .filter(s => s && s.trim())
  // Some versions of music-metadata don't surface ID3 USLT as common.lyrics.
  if (!parts.length) {
    parts = nativeTags(meta).filter(t => LYRIC_IDS.has(t.id)).map(t => tagText(t.value)).filter(s => s && s.trim())
  }
  return parts.length ? parts[0] : null
}

/** The file's own ISRC tag, if it has one. Cheap: skips covers. */
async function readIsrc(filePath) {
  const lib = metadata()
  if (!lib || !isAudioFile(filePath)) return null
  try {
    const meta = await lib.parseFile(filePath, { duration: false, skipCovers: true })
    const isrc = meta?.common?.isrc
    const value = Array.isArray(isrc) ? isrc[0] : isrc
    return value ? String(value).replace(/[^A-Za-z0-9]/g, '').toUpperCase() : null
  } catch { return null }
}

const AUDIO_EXT = /\.(mp3|flac|m4a|mp4|aac|ogg|oga|opus|wav|wma|aiff?|alac|ape|wv|dsf|dff)$/i

/** Only an absolute path to an existing audio file is ever read. */
function isAudioFile(filePath) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) return false
  if (/^(ghost|https?):/i.test(filePath) || !path.isAbsolute(filePath) || !AUDIO_EXT.test(filePath)) return false
  try { return fs.statSync(filePath).isFile() } catch { return false }
}

async function fetch(query) {
  const filePath = query.filePath
  if (!isAudioFile(filePath)) return null
  const sidecar = readSidecar(filePath)
  if (sidecar) return { raw: sidecar }
  const lib = metadata()
  if (!lib) return null
  try {
    const meta = await lib.parseFile(filePath, { duration: false, skipCovers: true })
    const own = privateLyrics(meta)
    if (own) return { lines: own.lines, language: own.language }
    const text = embeddedText(meta)
    return text ? { raw: text } : null
  } catch { return null }
}

module.exports = { fetch, readIsrc, privateLyrics, embeddedText }
