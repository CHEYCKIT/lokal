// "Lyrics analysis": what the music folder's files hold in their lyrics tags,
// counted the way MP3_Lyrics/count_lyrics.py does it:
//   syllable      word / syllable stamps (enhanced LRC, QRC/YRC karaoke, TTML)
//   synced        LRC time stamps in a lyrics frame, or a SYLT frame
//   plain         any other text
//   instrumental  the marker text the tagging script writes for them
//   unfound       the "can't find these lyrics" marker; the ones in a
//                 "рыбные каверы" folder are counted apart as fish covers
//   none          no lyrics at all (or an unreadable file)
// The report is kept in the settings table until the next run.

const fs = require('fs')
const path = require('path')
const mm = require('../musicMetadata')
const { lyricsFromMeta, isSyncedText } = require('./fileLyrics')
const { setFileLyrics } = require('../searchIndex')
const { isEnhanced, isKaraoke } = require('./lrc')

const INSTRUMENTAL_TRACK_TEXT = 'Instrumental track without lyrics'
const UNFOUND_TRACK_TEXT = 'Невозможно нагуглить слова этого трека'
const FISH_COVERS_FOLDER = 'рыбные каверы'
const SETTING_KEY = 'lyrics_analysis'
const KINDS = ['syllable', 'synced', 'plain', 'instrumental', 'unfound', 'none']

function musicFolder(db) {
  try { return db.prepare("SELECT value FROM settings WHERE key = 'music_folder'").get()?.value || null } catch { return null }
}

/** Every audio file under the folder, sorted so folders come out together. */
function listAudioFiles(root, exts) {
  const out = []
  const walk = (dir) => {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && exts.has(path.extname(entry.name).toLowerCase())) out.push(full)
    }
  }
  walk(root)
  return out.sort((a, b) => a.localeCompare(b))
}

function classify(text, folderRelative) {
  if (!text || !text.trim()) return { kind: 'none' }
  const trimmed = text.trim()
  if (trimmed === INSTRUMENTAL_TRACK_TEXT) return { kind: 'instrumental' }
  if (trimmed === UNFOUND_TRACK_TEXT) return { kind: 'unfound', fish: folderRelative.toLowerCase().includes(FISH_COVERS_FOLDER) }
  if (isSyllableText(trimmed)) return { kind: 'syllable' }
  return { kind: isSyncedText(trimmed) ? 'synced' : 'plain' }
}

function isSyllableText(text) {
  if (isEnhanced(text) || isKaraoke(text)) return true
  // TTML with timed spans inside the lines.
  return /<tt[\s>]/i.test(text) && /<span\b[^>]*\bbegin=/i.test(text)
}

const emptyCounts = () => ({ total: 0, syllable: 0, synced: 0, plain: 0, instrumental: 0, unfound: 0, fish: 0, none: 0 })

/**
 * Counts every file. onProgress({ done, total, folder }) is called as it goes;
 * job.cancelled stops it (nothing is saved then).
 */
async function runAnalysis(db, { exts, onProgress = () => {}, job = {} } = {}) {
  const root = musicFolder(db)
  if (!root || !fs.existsSync(root)) return { ok: false, error: 'No music folder selected' }
  const files = listAudioFiles(root, exts)
  const totals = emptyCounts()
  const folders = new Map()
  const saveKind = db.prepare('UPDATE tracks SET lyrics_kind = ? WHERE file_path = ?')
  const trackOf = db.prepare('SELECT id FROM tracks WHERE file_path = ?')
  let lastSent = 0
  for (let i = 0; i < files.length; i++) {
    if (job.cancelled) return { ok: false, cancelled: true }
    const file = files[i]
    const relDir = path.relative(root, path.dirname(file)).split(path.sep).join('/') || '.'
    let text = null
    try { text = lyricsFromMeta(await mm.parseFile(file, { duration: false, skipCovers: true })) } catch {}
    const { kind, fish } = classify(text, relDir)
    // The song list's Lyrics column gets the same answer while we're here.
    try { saveKind.run(kind === 'synced' || kind === 'syllable' ? 'sync' : require('./fileLyrics').lyricsKind(text), file) } catch {}
    try { setFileLyrics(db, trackOf.get(file)?.id, text || '') } catch {}
    const folder = folders.get(relDir) || emptyCounts()
    for (const counts of [totals, folder]) {
      counts.total++
      counts[kind]++
      if (fish) counts.fish++
    }
    folders.set(relDir, folder)
    const now = Date.now()
    if (now - lastSent > 100 || i === files.length - 1) {
      lastSent = now
      onProgress({ running: true, done: i + 1, total: files.length, folder: relDir })
    }
    // Let the main process breathe between files.
    if (i % 25 === 24) await new Promise(resolve => setImmediate(resolve))
  }
  const report = {
    finishedAt: Date.now(),
    root,
    totals,
    folders: [...folders.entries()]
      .map(([folder, counts]) => ({ folder, ...counts }))
      .sort((a, b) => a.folder.localeCompare(b.folder, undefined, { numeric: true })),
  }
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTING_KEY, JSON.stringify(report))
  return { ok: true, report }
}

function savedReport(db) {
  try {
    const value = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY)?.value
    return value ? JSON.parse(value) : null
  } catch { return null }
}

function clearReport(db) {
  try { db.prepare('DELETE FROM settings WHERE key = ?').run(SETTING_KEY) } catch {}
}

module.exports = { runAnalysis, savedReport, clearReport, KINDS, SETTING_KEY }
