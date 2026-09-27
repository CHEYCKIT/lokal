// Where Lokal gets its lyrics.
//
// Every enabled source is asked AT THE SAME TIME, but answers are taken in the
// user's priority order: the loop awaits them one at a time in that sequence,
// so a lower-priority source finishing first never pre-empts one still pending
// ahead of it. Asked one after another instead, every miss would cost a full
// round trip before the next source was even tried.
//
// Once something comes back:
//   - a syllable-timed answer wins outright;
//   - otherwise, with "prioritize syllable lyrics" OFF, the highest-priority
//     line-synced answer is taken as-is -- priority is priority;
//   - with it ON, a line-synced answer is only kept as a fallback while the
//     rest of the list is searched for a syllable-timed one.
// Plain (unsynced) text is only used when nothing synced turned up anywhere,
// and lyrics.ovh -- plain text only -- is not even contacted until then.
//
// Before anyone is asked for words, the recording is settled: the file's own
// ISRC tag if it has one, else one quick BiniLyrics search (capped at 2.5 s),
// so every source that can match on the exact recording does.

const { PROVIDERS, BY_ID, DEFAULT_ORDER, identify } = require('./providers')
const { readIsrc } = require('./providers/local')
const { parseAny } = require('./detect')
const { finish } = require('./postprocess')

const IDENTIFY_TIMEOUT_MS = 2500
const LAZY = new Set(['lyricsovh'])

const { forLyricsSearch, artistForSearch } = require('./names')

// ---------------------------------------------------------------- helpers

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise.then(v => { clearTimeout(timer); resolve(v) }, () => { clearTimeout(timer); resolve(null) })
  })
}

function sequenceFor(order, enabled) {
  const on = new Set(Array.isArray(enabled) && enabled.length ? enabled : DEFAULT_ORDER)
  const known = (Array.isArray(order) && order.length ? order : DEFAULT_ORDER).filter(id => BY_ID[id])
  // Sources added in an update after the user last saved their order fall in after it.
  const full = [...known, ...DEFAULT_ORDER.filter(id => !known.includes(id))]
  return full.filter(id => on.has(id))
}

/** Provider output -> finished result, or null. */
function toResult(providerId, output, names = {}) {
  if (!output) return null
  if (output.instrumental) return { type: 'instrumental', sync: 'none', lines: [], source: providerId, instrumental: true }
  let lines = output.lines
  let doc = output.doc || null
  if (!lines && output.raw) {
    const parsed = parseAny(output.raw)
    if (!parsed) return null
    lines = parsed.lines
    doc = parsed.doc
  }
  if (!Array.isArray(lines) || !lines.some(l => l && (l.text || l.bgText))) return null
  const result = finish(lines, {
    source: providerId,
    doc,
    isrc: output.isrc || null,
    language: output.language || doc?.language || null,
    title: names.title,
    artist: names.artist,
  })
  return result.type ? result : null
}

// ---------------------------------------------------------------- lookup

/**
 * @param query   { title, artist, album, duration, filePath, isrc?, keepCommaArtists? }
 * @param options { order?, enabled?, prioritizeSyllable?, only?: providerId }
 * @returns { result, attempts } -- result may be null; attempts lists what each source said.
 */
async function lookup(query, options = {}) {
  const controller = new AbortController()
  const signal = controller.signal
  const q = {
    ...query,
    searchTitle: forLyricsSearch(query.title),
    searchArtist: artistForSearch(query.artist, query.keepCommaArtists),
  }
  const sequence = options.only ? [options.only].filter(id => BY_ID[id]) : sequenceFor(options.order, options.enabled)
  const attempts = {}

  // Settle the recording first.
  if (!q.isrc && q.filePath) q.isrc = await withTimeout(readIsrc(q.filePath), 1500)
  let hit = null
  if (sequence.includes('binilyrics') && q.title && q.artist) {
    hit = await withTimeout(identify(q, { signal }), IDENTIFY_TIMEOUT_MS)
    if (!q.isrc && hit?.isrc) q.isrc = hit.isrc
  }

  const canQueryOnline = !!(q.title && q.artist)
  const started = new Map()
  const start = (id) => {
    if (started.has(id)) return started.get(id)
    const provider = BY_ID[id]
    const job = (async () => {
      if (id !== 'local' && !canQueryOnline) return null
      try {
        const output = await provider.fetch(q, { signal, hit: id === 'binilyrics' ? hit : null })
        return toResult(id, output, { title: q.searchTitle, artist: q.searchArtist })
      } catch {
        return null
      }
    })().then(result => {
      attempts[id] = result ? (result.instrumental ? 'instrumental' : result.sync) : 'miss'
      return result
    })
    started.set(id, job)
    return job
  }
  for (const id of sequence) if (!LAZY.has(id)) start(id)

  let lineSynced = null
  let plain = null
  let instrumental = null
  try {
    for (const id of sequence) {
      if (LAZY.has(id) && (lineSynced || plain)) continue
      const result = await start(id)
      if (!result) continue
      if (result.instrumental) { instrumental = instrumental || result; continue }
      if (result.sync === 'syllable') return { result, attempts }
      if (result.sync === 'line') {
        if (!options.prioritizeSyllable) return { result, attempts }
        lineSynced = lineSynced || result
        continue
      }
      plain = plain || result
    }
    return { result: lineSynced || plain || instrumental, attempts }
  } finally {
    controller.abort()
  }
}

/** Parses user-supplied content (import/search pick) through the same pipeline. */
function parseImported(content, type) {
  const raw = String(content || '')
  if (type === 'plain' || type === 'txt') {
    return finish(raw.split('\n').map(t => t.trim()).filter(Boolean).map(text => ({ text, time: null, words: [] })), { source: 'imported' })
  }
  const parsed = parseAny(raw)
  if (!parsed) return null
  return finish(parsed.lines, { source: 'imported', doc: parsed.doc, language: parsed.doc?.language || null })
}

module.exports = { lookup, parseImported, forLyricsSearch, artistForSearch, sequenceFor, PROVIDERS, DEFAULT_ORDER }
