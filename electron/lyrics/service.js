// The lyrics feature as the app sees it: cache in front of the repository,
// settings read from the DB, translation/romanization on request. Shared by
// the Electron IPC handlers and the web server's routes so both behave the same.
//
// Cache (lyrics_cache):
//   content  JSON array of lines -- unchanged shape, so the existing
//            search-by-lyrics feature (scanner.searchLyricsEntries) keeps
//            reading it directly.
//   meta     JSON { v, sync, duet, isrc, language, translationLang,
//            romanizationLang, attempts, settingsKey, pinned }.
//            A row without meta was written before this revamp: imported
//            lyrics are upgraded in place, anything else is refetched once so
//            old LRCLIB-only answers get the chance to become syllable-synced.

const { lookup, parseImported, DEFAULT_ORDER } = require('./repository')
const { describe } = require('./providers')
const { finish, isUntimed } = require('./postprocess')
const translation = require('./translate')

const META_VERSION = 2
const NEGATIVE_TTL_MS = 3 * 24 * 60 * 60 * 1000

// ---------------------------------------------------------------- schema

const prepared = new WeakSet()
function ensureSchema(db) {
  if (prepared.has(db)) return
  const cols = new Set(db.prepare('PRAGMA table_info(lyrics_cache)').all().map(c => c.name))
  if (!cols.has('fetched_at')) { try { db.exec('ALTER TABLE lyrics_cache ADD COLUMN fetched_at INTEGER DEFAULT 0') } catch {} }
  if (!cols.has('file_path')) { try { db.exec('ALTER TABLE lyrics_cache ADD COLUMN file_path TEXT') } catch {} }
  if (!cols.has('meta')) { try { db.exec('ALTER TABLE lyrics_cache ADD COLUMN meta TEXT') } catch {} }
  prepared.add(db)
}

// ---------------------------------------------------------------- settings

function readSettings(db) {
  let rows = []
  try { rows = db.prepare('SELECT key, value FROM settings').all() } catch {}
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]))
  const parseList = (v) => {
    if (!v) return null
    try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : null } catch { return null }
  }
  let keepCommaArtists = []
  try {
    const v = s.keep_comma_artists || ''
    keepCommaArtists = v.startsWith('[') ? JSON.parse(v) : v.split('\n').map(x => x.trim()).filter(Boolean)
  } catch { keepCommaArtists = [] }
  const savedOrder = parseList(s.lyrics_sources_order)
  const order = savedOrder ? [...savedOrder] : [...DEFAULT_ORDER]
  // Introduce the new source above BetterLyrics for existing installations,
  // while preserving every source preference the user explicitly saved.
  if (!order.includes('spicylyrics')) {
    const at = order.findIndex(id => id === 'betterlyrics' || id === 'betterlyrics_qq')
    order.splice(at < 0 ? order.length : at, 0, 'spicylyrics')
  }
  const savedEnabled = parseList(s.lyrics_sources_enabled)
  // Migrate existing installations with the newly available provider enabled;
  // once the settings page saves an explicit list, later toggles are retained.
  const enabled = savedEnabled
    ? [...savedEnabled, ...(!savedEnabled.includes('spicylyrics') ? ['spicylyrics'] : [])]
    : DEFAULT_ORDER
  return {
    order,
    enabled,
    prioritizeSyllable: s.lyrics_prioritize_syllable === '1',
    keepCommaArtists,
    spicyKey: s.spicylyrics_api_key || '',
    spotifyCookie: s.spotify_sp_dc || '',
    // A negative answer is only trusted while the same sources are configured.
    settingsKey: JSON.stringify([order.filter(id => enabled.includes(id)), s.lyrics_prioritize_syllable === '1', !!s.spicylyrics_api_key, !!s.spotify_sp_dc]),
  }
}

// ---------------------------------------------------------------- cache

function readRow(db, trackId, filePath) {
  let row = trackId ? db.prepare('SELECT * FROM lyrics_cache WHERE track_id = ?').get(trackId) : null
  if (!row && filePath) {
    try { row = db.prepare('SELECT * FROM lyrics_cache WHERE file_path = ?').get(filePath) } catch {}
  }
  return row || null
}

function parseMeta(row) {
  if (!row?.meta) return null
  try { const m = JSON.parse(row.meta); return m && m.v === META_VERSION ? m : null } catch { return null }
}

function writeRow(db, trackId, filePath, result, extra = {}) {
  const meta = {
    v: META_VERSION,
    sync: result?.sync || null,
    duet: !!result?.duet,
    isrc: result?.isrc || null,
    language: result?.language || null,
    translationLang: result?.translationLang || null,
    romanizationLang: result?.romanizationLang || null,
    attribution: result?.attribution || null,
    ...extra,
  }
  db.prepare('INSERT OR REPLACE INTO lyrics_cache (track_id, lyrics_type, content, source, fetched_at, file_path, meta) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(trackId, result?.type || null, JSON.stringify(result?.lines || []), result?.source || 'no-results', Date.now(), filePath || null, JSON.stringify(meta))
}

function fromRow(row, meta) {
  let lines = []
  try { lines = JSON.parse(row.content || '[]') } catch {}
  return {
    type: row.lyrics_type,
    sync: meta.sync,
    lines,
    source: row.source,
    isrc: meta.isrc,
    language: meta.language,
    duet: meta.duet,
    translationLang: meta.translationLang,
    romanizationLang: meta.romanizationLang,
    attempts: meta.attempts || null,
    pinned: !!meta.pinned,
    attribution: meta.attribution || null,
  }
}

/**
 * True when a legacy line's word timings were invented by the old LRC parser,
 * which split each line's slot evenly across its words. Real (TTML) timings
 * are never all exactly equal.
 */
function isEvenSplit(words) {
  if (!Array.isArray(words) || words.length < 2) return false
  const spans = words.map(w => (w.end ?? 0) - (w.time ?? 0))
  return spans.every(s => Math.abs(s - spans[0]) < 0.002)
}

/** Old imported lines (pre-revamp shape) -> new shape, run through the shared finish pass. */
function upgradeLegacy(row) {
  let lines = []
  try { lines = JSON.parse(row.content || '[]') } catch { return null }
  if (!Array.isArray(lines) || !lines.length) return null
  const multiWord = lines.filter(l => Array.isArray(l.words) && l.words.length >= 2)
  const invented = multiWord.length > 0 && multiWord.filter(l => isEvenSplit(l.words)).length / multiWord.length > 0.8
  const toUnits = (list) => (Array.isArray(list) ? list : [])
    .filter(w => w && w.word && w.time != null)
    .map((w, i, arr) => ({ word: String(w.word), time: w.time, end: w.end ?? null, space: i < arr.length - 1 && !String(w.word).endsWith('-') }))
  const converted = lines.map(l => {
    const words = invented ? [] : toUnits(l.words)
    const bgWords = invented ? [] : toUnits(l.bgWords)
    const out = {
      time: l.time ?? null,
      end: l.end ?? null,
      endStated: words.length > 0,
      text: String(l.text || ''),
      words,
    }
    if (bgWords.length) { out.bgWords = bgWords; out.bgText = l.bgText || bgWords.map(w => w.word).join(' ') }
    else if (l.bgText) out.bgText = l.bgText
    if (l.agent) out.agent = l.agent
    return out
  })
  const result = finish(converted, { source: row.source || 'imported' })
  return result.type ? result : null
}

// ---------------------------------------------------------------- trusted paths

/**
 * The file a track actually lives at, from the library -- never from the
 * caller. The web server is reachable over the network, and the local-file
 * source reads sidecar files and tags next to whatever path it's given; a
 * client-supplied path would let any client read arbitrary .txt/.lrc/.ttml
 * files off the host (CWE-22). Callers' filePath arguments are ignored.
 */
function trustedFilePath(db, trackId) {
  if (!trackId) return null
  try {
    const row = db.prepare('SELECT file_path FROM tracks WHERE id = ?').get(trackId)
    // Ghost tracks (online songs, imported entries) have no file to read.
    if (String(row?.file_path || '').startsWith('ghost://')) return null
    return row?.file_path || null
  } catch { return null }
}

// ---------------------------------------------------------------- public API

function instrumentalResult(db, trackId) {
  if (!trackId) return null
  try {
    const track = db.prepare('SELECT instrumental FROM tracks WHERE id = ?').get(trackId)
    if (!track?.instrumental) return null
  } catch { return null }
  return { type: 'instrumental', sync: 'none', lines: [], source: 'instrumental-tag', instrumental: true }
}

/**
 * The lyrics for a track: cache first, then every configured source.
 * @param args { trackId, title, artist, album, duration, filePath, refresh? }
 */
async function getLyrics(db, args) {
  ensureSchema(db)
  const { trackId, title, artist, album, duration } = args
  const filePath = trustedFilePath(db, trackId)
  const instrumental = instrumentalResult(db, trackId)
  if (instrumental) return instrumental
  const settings = readSettings(db)
  // Cached lyrics with untimed stamps, as plain text: kept when the fresh
  // lookup finds nothing better (every source down, say).
  let untimedFallback = null

  if (!args.refresh) {
    const row = readRow(db, trackId, filePath)
    if (row) {
      const meta = parseMeta(row)
      if (meta) {
        if (row.source === 'no-results') {
          const fresh = row.fetched_at && Date.now() - row.fetched_at < NEGATIVE_TTL_MS
          if (fresh && meta.settingsKey === settings.settingsKey) return null
        } else if (row.lyrics_type === 'synced' && isUntimed(fromRow(row, meta).lines)) {
          // Cached before untimed stamps were recognised (see isUntimed). A
          // source the user picked stays, as the plain text it really is;
          // anything else is looked up again so a truly synced source can win,
          // falling back to that plain text.
          const plain = finish(fromRow(row, meta).lines.map(l => ({ text: l.text, time: null, words: [] })), { source: row.source })
          if (meta.pinned) {
            writeRow(db, trackId || row.track_id, filePath || row.file_path, plain, { attempts: meta.attempts, pinned: true })
            return { ...plain, attempts: meta.attempts || null, pinned: true }
          }
          if (plain.type) untimedFallback = { result: plain, attempts: meta.attempts || null }
        } else {
          if (trackId && row.track_id !== trackId) writeRow(db, trackId, filePath, fromRow(row, meta), { attempts: meta.attempts, pinned: meta.pinned })
          return fromRow(row, meta)
        }
      } else if (row.source === 'imported' || String(row.source || '').startsWith('imported')) {
        const upgraded = upgradeLegacy(row)
        if (upgraded) {
          writeRow(db, trackId || row.track_id, filePath || row.file_path, upgraded)
          return upgraded
        }
      }
      // Legacy non-imported rows, stale negatives and untimed answers fall through to a fresh lookup.
    }
  }

  const { result, attempts } = await lookup(
    { title, artist, album, duration: Number(duration) || 0, filePath, keepCommaArtists: settings.keepCommaArtists },
    settings,
  )
  if (!trackId) return result
  if (result && !result.instrumental) {
    writeRow(db, trackId, filePath, result, { attempts })
    return { ...result, attempts }
  }
  if (result?.instrumental) return result
  if (untimedFallback) {
    const kept = { ...(untimedFallback.attempts || {}), ...attempts }
    writeRow(db, trackId, filePath, untimedFallback.result, { attempts: kept })
    return { ...untimedFallback.result, attempts: kept }
  }
  writeRow(db, trackId, filePath, null, { attempts, settingsKey: settings.settingsKey })
  return null
}

/** Asks exactly one source (the "try another source" picker). Pins the answer when found. */
async function getLyricsFrom(db, args, providerId) {
  ensureSchema(db)
  const settings = readSettings(db)
  const filePath = trustedFilePath(db, args.trackId)
  const { result, attempts } = await lookup(
    { title: args.title, artist: args.artist, album: args.album, duration: Number(args.duration) || 0, filePath, keepCommaArtists: settings.keepCommaArtists },
    { only: providerId, spicyKey: settings.spicyKey, spotifyCookie: settings.spotifyCookie },
  )
  if (result && !result.instrumental && args.trackId) {
    // Merge this attempt into what the row already knew about the other sources.
    const previous = parseMeta(readRow(db, args.trackId, filePath) || {})
    const merged = { ...(previous?.attempts || {}), ...attempts }
    writeRow(db, args.trackId, filePath, result, { attempts: merged, pinned: true })
    return { ...result, attempts: merged, pinned: true }
  }
  return result ? { ...result, attempts } : { type: null, lines: [], source: providerId, attempts, miss: true }
}

function importLyrics(db, trackId, content, type) {
  ensureSchema(db)
  if (!trackId) return null
  const filePath = trustedFilePath(db, trackId)
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.join('\n') : String(content ?? '')
  const result = parseImported(text.replace(/\r\n/g, '\n'), type)
  if (!result) return null
  writeRow(db, trackId, filePath, result, { pinned: true })
  return result
}

function clearCache(db, trackId) {
  if (!trackId) return { ok: false }
  db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(trackId)
  try { db.prepare('DELETE FROM lyrics_translations WHERE track_id = ?').run(trackId) } catch {}
  return { ok: true }
}

function sources(db) {
  const settings = readSettings(db)
  return {
    providers: describe(),
    order: settings.order,
    enabled: settings.enabled,
    prioritizeSyllable: settings.prioritizeSyllable,
    defaultOrder: DEFAULT_ORDER,
  }
}

async function translate(db, trackId, lines, targetLang) {
  return translation.translate(db, trackId, lines, targetLang)
}

async function romanize(db, trackId, lines) {
  return translation.romanize(db, trackId, lines)
}

module.exports = { getLyrics, getLyricsFrom, importLyrics, clearCache, sources, translate, romanize, readSettings, upgradeLegacy }
