// Lyrics that ship with the file itself:
//   - a sidecar next to the audio: song.ttml, song.elrc, song.lrc, song.txt
//   - lyrics embedded in the tags (ID3 USLT/SYLT, Vorbis LYRICS/UNSYNCEDLYRICS,
//     MP4 ©lyr...), which music-metadata surfaces as common.lyrics
// Also reports the file's own ISRC tag, which lets the online sources match
// the exact recording without a fuzzy name search.

const fs = require('fs')
const path = require('path')

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

function embeddedText(meta) {
  const lyrics = meta?.common?.lyrics
  if (!lyrics) return null
  const parts = (Array.isArray(lyrics) ? lyrics : [lyrics])
    .map(l => (typeof l === 'string' ? l : l?.text || ''))
    .filter(s => s && s.trim())
  return parts.length ? parts.join('\n') : null
}

/** The file's own ISRC tag, if it has one. Cheap: skips covers. */
async function readIsrc(filePath) {
  const lib = metadata()
  if (!lib || !filePath || !fs.existsSync(filePath)) return null
  try {
    const meta = await lib.parseFile(filePath, { duration: false, skipCovers: true })
    const isrc = meta?.common?.isrc
    const value = Array.isArray(isrc) ? isrc[0] : isrc
    return value ? String(value).replace(/[^A-Za-z0-9]/g, '').toUpperCase() : null
  } catch { return null }
}

async function fetch(query) {
  const filePath = query.filePath
  if (!filePath || /^(ghost|https?):/i.test(filePath) || !fs.existsSync(filePath)) return null
  const sidecar = readSidecar(filePath)
  if (sidecar) return { raw: sidecar }
  const lib = metadata()
  if (!lib) return null
  try {
    const meta = await lib.parseFile(filePath, { duration: false, skipCovers: true })
    const text = embeddedText(meta)
    return text ? { raw: text } : null
  } catch { return null }
}

module.exports = { fetch, readIsrc }
