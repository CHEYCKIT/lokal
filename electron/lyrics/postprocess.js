// The last pass every provider's lines go through, whichever one won:
//
//   1. background vocals written as a trailing bracket are split off the lead
//   2. duet lines get a side (start/end) from who sang them
//   3. instrumental breaks become explicit `gap` lines -- including the intro
//   4. the sync level is classified (syllable / line / none)
//
// Done once here rather than inside each parser so every source reads the same.

const { joinUnits, round3, lineEnd, hasKnownEnd } = require('./model')

/** Shorter silences aren't worth interrupting the flow of the lyrics for. */
const MIN_GAP_SECONDS = 4

// ---------------------------------------------------------------- background
// "I'm foolishly patient (Foolishly patient)" -- a bracket doing the job of a
// second voice. Only TTML (x-bg) and LyricsPlus (isBackground) mark it
// structurally; everyone else writes the bracket inline, which dragged the
// sweep through words sung over the *next* line.

function bracketStart(text) {
  if (!text.endsWith(')')) return null
  let depth = 0
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === ')') depth++
    else if (ch === '(') {
      depth--
      if (depth === 0) return i > 0 ? i : null
    }
  }
  return null
}

function splitTrailingBracket(line) {
  if (line.gap || line.bgText || !line.text) return line
  const open = bracketStart(line.text)
  if (open == null) return line
  const lead = line.text.slice(0, open).trimEnd()
  const backing = line.text.slice(open).trim()
  if (!lead || !/[\p{L}\p{N}]/u.test(backing)) return line

  if (!line.words?.length) return { ...line, text: lead, bgText: backing, bgWords: [] }

  // Find the unit where the bracket starts; bail if it opens mid-unit ("wait(ing)").
  let at = 0
  let split = -1
  for (let i = 0; i < line.words.length; i++) {
    if (at === open) { split = i; break }
    if (at > open) break
    at += line.words[i].word.length + (line.words[i].space ? 1 : 0)
  }
  if (split <= 0) return line
  const leadWords = line.words.slice(0, split).map((w, i, a) => (i === a.length - 1 ? { ...w, space: false } : w))
  const bgWords = line.words.slice(split)
  return { ...line, text: joinUnits(leadWords), words: leadWords, bgText: joinUnits(bgWords), bgWords }
}

// ---------------------------------------------------------------- duet sides
// Sides alternate every time the voice changes, which keeps a three-voice song
// reading as a conversation; a group line (everyone) stays left without taking
// a turn. If nearly everything lands right, the whole song is flipped.

const GROUP_AGENT = 'v1000'
const OTHER_AGENT = 'v2000'
const MOSTLY_RIGHT = 0.85

function assignSides(lines, agentTypes = {}) {
  let left = true
  let lastVoice = null
  let rightward = 0
  let placed = 0
  const sides = lines.map(line => {
    const singer = line.agent
    if (!singer || line.gap) return 'start'
    const type = agentTypes[singer] || (singer === GROUP_AGENT ? 'group' : singer === OTHER_AGENT ? 'other' : 'person')
    placed++
    if (type === 'group') return 'start'
    if (lastVoice === null) left = type !== 'other'
    else if (singer !== lastVoice) left = !left
    lastVoice = singer
    if (!left) rightward++
    return left ? 'start' : 'end'
  })
  const voices = new Set(lines.filter(l => l.agent && !l.gap).map(l => l.agent).filter(a => (agentTypes[a] || 'person') !== 'group' && a !== GROUP_AGENT))
  const duet = voices.size > 1
  const flip = placed > 0 && rightward / placed >= MOSTLY_RIGHT
  lines.forEach((line, i) => {
    let side = duet ? sides[i] : 'start'
    if (duet && flip) side = side === 'start' ? 'end' : 'start'
    line.side = side
  })
  return duet
}

// ---------------------------------------------------------------- gaps
// A break is only drawn where the line before it says when its singing stopped.
// Line-synced sources don't, so they only ever get the intro break.

function withInstrumentalGaps(lines) {
  const sung = lines.filter(l => !l.gap)
  if (!sung.length || sung[0].time == null) return sung
  const out = []
  if (sung[0].time >= MIN_GAP_SECONDS) out.push({ time: 0, end: sung[0].time, text: '', words: [], gap: true })
  sung.forEach((line, i) => {
    out.push(line)
    const next = sung[i + 1]
    if (!next || !hasKnownEnd(line)) return
    const end = lineEnd(line)
    if (next.time - end >= MIN_GAP_SECONDS && end > line.time) {
      out.push({ time: round3(end), end: next.time, text: '', words: [], gap: true })
    }
  })
  return out
}

// ---------------------------------------------------------------- embedded extras

/** Attaches a source document's own translation / romanization to its lines, by key. */
function attachEmbedded(lines, { translations = {}, transliterations = {} } = {}) {
  const trLang = Object.keys(translations)[0]
  const tlLang = Object.keys(transliterations)[0]
  if (!trLang && !tlLang) return { translationLang: null, romanizationLang: null }
  for (const line of lines) {
    if (!line.key) continue
    const tr = trLang ? translations[trLang][line.key] : null
    if (tr?.text) line.translation = { text: tr.text, bgText: tr.bgText || null }
    const tl = tlLang ? transliterations[tlLang][line.key] : null
    if (tl?.text) line.romanization = tl
  }
  return { translationLang: trLang || null, romanizationLang: tlLang || null }
}

// ---------------------------------------------------------------- finish

function classify(lines) {
  const sung = lines.filter(l => !l.gap && l.text)
  if (!sung.length) return 'none'
  if (sung.some(l => l.words?.length)) return 'syllable'
  if (sung.some(l => l.time != null)) return 'line'
  return 'none'
}

/**
 * Turns a parser's raw output into a finished result.
 * `doc` is the optional TTML extras ({ agents, translations, transliterations }).
 */
function finish(rawLines, { source, doc = null, isrc = null, language = null } = {}) {
  let lines = (rawLines || [])
    .filter(l => l && (l.text || l.bgText))
    .map(l => ({ ...l, text: String(l.text || '').trim() }))
  const sync = classify(lines)
  if (sync === 'none') {
    lines = lines.map(l => ({ text: l.text, time: null, end: null, words: [] }))
    return { type: lines.length ? 'unsynced' : null, sync, lines, source, isrc, language, duet: false }
  }
  lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
  lines = lines.map(splitTrailingBracket)
  const embedded = doc ? attachEmbedded(lines, doc) : { translationLang: null, romanizationLang: null }
  const duet = assignSides(lines, doc?.agents || {})
  lines = withInstrumentalGaps(lines)
  return {
    type: 'synced',
    sync,
    lines,
    source,
    isrc: isrc || null,
    language: language || null,
    duet,
    translationLang: embedded.translationLang,
    romanizationLang: embedded.romanizationLang,
  }
}

module.exports = { finish, splitTrailingBracket, assignSides, withInstrumentalGaps, attachEmbedded, MIN_GAP_SECONDS }
