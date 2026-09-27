// On-demand lyric translation and romanization.
//
// Apple's own translation / romanization, when the source document carried
// them (see postprocess.attachEmbedded), always wins -- they are written by
// people and romanizations come syllable-timed. This is the fallback for
// everything else: Google's public translate endpoint.
//
// The old implementation made one request per line, sequentially -- a
// 60-line song was 60 round trips and routinely tripped rate limits. Here
// the whole song goes in a few batched requests: lines are joined with a
// private-use marker Google leaves untouched, and split back apart after.
//
// Results are cached in lyrics_translations keyed on the exact source text, so
// a song is only ever translated once per target language.

const crypto = require('crypto')
const { request } = require('./http')
const { lineText } = require('./model')

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single'
const MAX_BATCH_CHARS = 3500
const MAX_PARALLEL = 2
const MARKER_RE = /\s*[^]*\s*/g
const ROMANIZE_KEY = '__romanize'

function marker(i) { return `${String(i).padStart(4, '0')}` }

/** Flattens lines into translatable text slots: lead, and background vocal where present. */
function slotsFor(lines) {
  const slots = []
  lines.forEach((line, index) => {
    if (!line || line.gap) return
    const text = lineText(line)
    if (text) slots.push({ index, part: 'text', text })
    if (line.bgText && String(line.bgText).trim()) slots.push({ index, part: 'bgText', text: String(line.bgText).trim() })
  })
  return slots
}

function batches(slots) {
  const out = []
  let current = []
  let size = 0
  for (const slot of slots) {
    const cost = slot.text.length + 8
    if (current.length && size + cost > MAX_BATCH_CHARS) { out.push(current); current = []; size = 0 }
    current.push(slot)
    size += cost
  }
  if (current.length) out.push(current)
  return out
}

function payload(batch) {
  return batch.map((slot, i) => (i === 0 ? slot.text : `${marker(i)}\n${slot.text}`)).join('\n')
}

// `gtx` is the usual public client; `dict-chrome-ex` is the same endpoint as
// the Chrome dictionary extension calls it, and is tried when gtx is
// rate-limited (common on shared or cloud IPs).
const CLIENTS = ['gtx', 'dict-chrome-ex']

async function callGoogle(batch, options) {
  for (const client of CLIENTS) {
    const answer = await callGoogleWith(client, batch, options)
    if (answer) return answer
  }
  return null
}

async function callGoogleWith(client, batch, { tl, dt, sl = 'auto' }) {
  const url = `${ENDPOINT}?client=${client}&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=${dt}`
  const text = await request(url, {
    method: 'POST',
    timeoutMs: 12000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ q: payload(batch) }).toString(),
  })
  if (!text) return null
  let root
  try { root = JSON.parse(text) } catch { return null }
  if (!Array.isArray(root) || !Array.isArray(root[0])) return null
  // dt=t: segment[0] is the translation. dt=rm: the romanization of the source
  // sits at segment[3] (segment[2] would be the target's).
  const joined = root[0].map(seg => (Array.isArray(seg) ? (dt === 'rm' ? (seg[3] ?? '') : (seg[0] ?? '')) : '')).join('')
  const parts = joined.split(MARKER_RE).map(s => s.trim())
  if (parts.length !== batch.length) return null
  const source = typeof root[2] === 'string' ? root[2] : null
  return { parts, source, weight: batch.reduce((n, s) => n + s.text.length, 0) }
}

async function runAll(slotBatches, options) {
  const answers = []
  for (let i = 0; i < slotBatches.length; i += MAX_PARALLEL) {
    const group = slotBatches.slice(i, i + MAX_PARALLEL)
    answers.push(...await Promise.all(group.map(b => callGoogle(b, options))))
  }
  return answers
}

function baseLang(tag) { return String(tag || '').toLowerCase().split(/[-_]/)[0] }

function sameLanguage(source, target) {
  const s = baseLang(source)
  const t = baseLang(target)
  if (!s || !t) return false
  if (s === 'zh' && t === 'zh') {
    // zh-CN vs zh-TW are the same language in different scripts: still translate.
    return String(source).toLowerCase() === String(target).toLowerCase()
  }
  return s === t
}

function dominantSource(answers) {
  const weights = {}
  for (const a of answers) if (a?.source) weights[baseLang(a.source)] = (weights[baseLang(a.source)] || 0) + a.weight
  return Object.entries(weights).sort((a, b) => b[1] - a[1])[0]?.[0] || null
}

function hasNonLatinLetters(text) {
  return /[^\u0000-ɏḀ-ỿ\s\p{P}\p{N}\p{S}]/u.test(text || '')
}

function sourceHash(slots) {
  return crypto.createHash('sha1').update(JSON.stringify(slots.map(s => s.text))).digest('hex')
}

/** Rebuilds per-line { text, bgText } from slot answers, aligned with the input lines. */
function rebuild(lines, slots, texts) {
  const out = lines.map(() => null)
  slots.forEach((slot, i) => {
    const value = texts[i]
    if (value == null) return
    const entry = out[slot.index] || (out[slot.index] = { text: '', bgText: null })
    entry[slot.part] = value
  })
  return out
}

function ensureTable(db) {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS lyrics_translations (
      track_id TEXT NOT NULL, target_lang TEXT NOT NULL, source_hash TEXT NOT NULL,
      detected_lang TEXT, content TEXT, provider TEXT, fetched_at INTEGER DEFAULT 0,
      PRIMARY KEY (track_id, target_lang, source_hash))`)
  } catch { /* exists */ }
}

function readCache(db, trackId, key, hash) {
  try {
    const row = db.prepare('SELECT * FROM lyrics_translations WHERE track_id = ? AND target_lang = ? AND source_hash = ?').get(trackId, key, hash)
    if (!row?.content) return null
    const texts = JSON.parse(row.content)
    return Array.isArray(texts) ? { texts, detected: row.detected_lang } : null
  } catch { return null }
}

function writeCache(db, trackId, key, hash, detected, texts) {
  try {
    db.prepare('INSERT OR REPLACE INTO lyrics_translations (track_id, target_lang, source_hash, detected_lang, content, provider, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(trackId, key, hash, detected || null, JSON.stringify(texts), 'google-gtx-batch', Date.now())
  } catch { /* cache is best effort */ }
}

/**
 * @returns { status: 'translated' | 'same-language' | 'unavailable', lines, detectedLang }
 * `lines` is aligned with the input: each entry { text, bgText } or null.
 */
async function translate(db, trackId, lines, targetLang = 'en') {
  const target = String(targetLang || 'en').trim() || 'en'
  const input = Array.isArray(lines) ? lines : []
  const slots = slotsFor(input)
  if (!slots.length) return { status: 'unavailable', lines: [], detectedLang: null }
  ensureTable(db)
  const id = trackId || 'unknown-track'
  const hash = sourceHash(slots)
  const cached = readCache(db, id, target, hash)
  if (cached && cached.texts.length === slots.length) {
    if (sameLanguage(cached.detected, target)) return { status: 'same-language', lines: [], detectedLang: cached.detected }
    return { status: 'translated', lines: rebuild(input, slots, cached.texts), detectedLang: cached.detected }
  }
  const slotBatches = batches(slots)
  const answers = await runAll(slotBatches, { tl: target, dt: 't' })
  if (answers.some(a => !a)) return { status: 'unavailable', lines: [], detectedLang: null }
  const detected = dominantSource(answers)
  const texts = answers.flatMap(a => a.parts)
  if (texts.length !== slots.length) return { status: 'unavailable', lines: [], detectedLang: detected }
  writeCache(db, id, target, hash, detected, texts)
  if (sameLanguage(detected, target)) return { status: 'same-language', lines: [], detectedLang: detected }
  return { status: 'translated', lines: rebuild(input, slots, texts), detectedLang: detected }
}

/**
 * @returns { status: 'romanized' | 'already-latin' | 'unavailable', lines, detectedLang }
 * Only lines that actually contain non-Latin script are romanized; the rest
 * come back null so the view shows nothing under them.
 */
async function romanize(db, trackId, lines) {
  const input = Array.isArray(lines) ? lines : []
  const allSlots = slotsFor(input)
  const slots = allSlots.filter(s => hasNonLatinLetters(s.text))
  if (!slots.length) return { status: 'already-latin', lines: [], detectedLang: null }
  ensureTable(db)
  const id = trackId || 'unknown-track'
  const hash = sourceHash(slots)
  const cached = readCache(db, id, ROMANIZE_KEY, hash)
  if (cached && cached.texts.length === slots.length) {
    return { status: 'romanized', lines: rebuild(input, slots, cached.texts), detectedLang: cached.detected }
  }
  const answers = await runAll(batches(slots), { tl: 'en', dt: 'rm' })
  if (answers.some(a => !a)) return { status: 'unavailable', lines: [], detectedLang: null }
  const texts = answers.flatMap(a => a.parts)
  if (texts.length !== slots.length || texts.every(t => !t)) return { status: 'unavailable', lines: [], detectedLang: null }
  const detected = dominantSource(answers)
  writeCache(db, id, ROMANIZE_KEY, hash, detected, texts)
  return { status: 'romanized', lines: rebuild(input, slots, texts), detectedLang: detected }
}

module.exports = { translate, romanize, hasNonLatinLetters, slotsFor, batches, payload }
