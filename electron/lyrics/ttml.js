// Apple-style TTML -> Lokal lyrics.
//
// What a word-timed document says, and how it is read here:
//
//   <p begin end itunes:key="L1" ttm:agent="v1">
//     <span begin end>e</span><span begin end>nough</span> <span ...>said</span>
//     <span ttm:role="x-bg"> <span begin end>(ooh)</span> </span>
//   </p>
//
// - spans flush against each other are syllables of ONE word; a whitespace text
//   node between them is a word boundary. That becomes each unit's `space` flag.
// - ttm:role="x-bg" is the answering vocal, kept as its own line under the lead.
// - x-translation / x-roman spans inline in a line are skipped (they are not
//   sung words); the document-level <translations>/<transliterations> blocks in
//   the head are read instead, keyed back to lines by itunes:key.
// - itunes:timing (or lrc:timing on mirrors) = Word | Line | None.

const { parseXml, attr, findAll, findFirst, localName, textContent } = require('./xml')
const { clockToSeconds, unit, joinUnits, spacing } = require('./model')

const SKIPPED_ROLES = new Set(['x-translation', 'x-roman'])
const BACKGROUND_ROLE = 'x-bg'

function hasTimedDescendant(node) {
  for (const child of node.children || []) {
    if (child.type !== 'element') continue
    if (attr(child, 'begin') !== undefined) return true
    if (hasTimedDescendant(child)) return true
  }
  return false
}

/**
 * Walks a paragraph (or a transliteration <text>) collecting timed units in
 * document order. Whitespace between elements becomes the previous unit's
 * `space`; stray untimed text (usually punctuation) is glued onto a neighbour.
 */
function collect(node, out, bg) {
  let pendingPrefix = ''
  const lastOf = (list) => list[list.length - 1]
  for (const child of node.children || []) {
    if (child.type === 'text') {
      const text = child.text
      if (!text) continue
      if (/^\s+$/.test(text)) {
        const last = lastOf(out)
        if (last) last.space = true
        continue
      }
      const { core, lead, trail } = spacing(text)
      const last = lastOf(out)
      if (last) {
        if (lead) last.space = true
        if (lead) pendingPrefix += core
        else last.word += core
        if (trail && !lead) last.space = true
      } else {
        pendingPrefix += core
      }
      continue
    }
    if (child.type !== 'element' || localName(child.name) !== 'span') {
      if (child.type === 'element') collect(child, out, bg)
      continue
    }
    const role = attr(child, 'role')
    if (role && SKIPPED_ROLES.has(role)) continue
    if (role === BACKGROUND_ROLE) {
      // A space before the backing span still ends the lead's current word.
      collect(child, bg, bg)
      continue
    }
    const begin = attr(child, 'begin')
    if (begin !== undefined && !hasTimedDescendant(child)) {
      const raw = textContent(child)
      const { core, lead, trail } = spacing(raw)
      const last = lastOf(out)
      if (lead && last) last.space = true
      if (!core) { if (trail && last) last.space = true; continue }
      out.push(unit(pendingPrefix + core, clockToSeconds(begin), clockToSeconds(attr(child, 'end')), trail))
      pendingPrefix = ''
      continue
    }
    collect(child, out, bg)
  }
  if (pendingPrefix) {
    const last = lastOf(out)
    if (last) last.word += pendingPrefix
  }
}

function finishUnits(units, fallbackEnd) {
  const clean = units.filter(u => u.word && u.time != null)
  clean.forEach((u, i) => {
    if (u.end == null || u.end < u.time) {
      const next = clean[i + 1]
      u.end = next ? next.time : (fallbackEnd ?? u.time + 0.4)
    }
  })
  if (clean.length) clean[clean.length - 1].space = false
  return clean
}

function readAgents(doc) {
  const types = {}
  for (const agent of findAll(doc, 'agent')) {
    const id = attr(agent, 'id')
    if (id) types[id] = attr(agent, 'type') || 'person'
  }
  return types
}

function readTranslations(doc) {
  const out = {}
  for (const tr of findAll(doc, 'translation')) {
    const lang = attr(tr, 'lang') || 'und'
    const map = out[lang] || (out[lang] = {})
    for (const t of findAll(tr, 'text')) {
      const key = attr(t, 'for')
      if (!key) continue
      // Translations of the backing vocal ride along as x-bg spans.
      let main = ''
      let bg = ''
      const walkText = (node, into) => {
        for (const c of node.children || []) {
          if (c.type === 'text') { if (into === 'bg') bg += c.text; else main += c.text }
          else if (attr(c, 'role') === BACKGROUND_ROLE) walkText(c, 'bg')
          else walkText(c, into)
        }
      }
      walkText(t, 'main')
      map[key] = { text: main.replace(/\s+/g, ' ').trim(), bgText: bg.replace(/\s+/g, ' ').trim() || null }
    }
  }
  return out
}

function readTransliterations(doc) {
  const out = {}
  for (const tl of findAll(doc, 'transliteration')) {
    const lang = attr(tl, 'lang') || 'und-Latn'
    const map = out[lang] || (out[lang] = {})
    for (const t of findAll(tl, 'text')) {
      const key = attr(t, 'for')
      if (!key) continue
      const units = []
      const bgUnits = []
      collect(t, units, bgUnits)
      const words = finishUnits(units)
      const bgWords = finishUnits(bgUnits)
      const text = words.length ? joinUnits(words) : textContent(t).replace(/\s+/g, ' ').trim()
      map[key] = {
        text,
        words: words.length ? words : [],
        bgText: bgWords.length ? joinUnits(bgWords) : null,
        bgWords: bgWords.length ? bgWords : [],
      }
    }
  }
  return out
}

/**
 * Returns { lines, timing, language, agents, translations, transliterations }
 * or null when the document is not TTML at all.
 */
function parseTTML(xml) {
  if (!xml || !/<tt[\s>]/i.test(xml)) return null
  const doc = parseXml(xml)
  const tt = findFirst(doc, 'tt')
  if (!tt) return null
  const timing = String(attr(tt, 'timing') || '').toLowerCase() || null
  const language = attr(tt, 'lang') || null
  const agents = readAgents(doc)
  const body = findFirst(tt, 'body') || tt

  const lines = []
  for (const p of findAll(body, 'p')) {
    const begin = clockToSeconds(attr(p, 'begin'))
    const endAttr = clockToSeconds(attr(p, 'end'))
    const units = []
    const bgUnits = []
    collect(p, units, bgUnits)
    const words = finishUnits(units, endAttr)
    const bgWords = finishUnits(bgUnits, endAttr)

    let text = words.length ? joinUnits(words) : ''
    if (!words.length) {
      // Line- or un-timed paragraph: its text is everything but the backing voice.
      let main = ''
      const gather = (node) => {
        for (const c of node.children || []) {
          if (c.type === 'text') main += c.text
          else if (attr(c, 'role') === BACKGROUND_ROLE || SKIPPED_ROLES.has(attr(c, 'role'))) continue
          else gather(c)
        }
      }
      gather(p)
      text = main.replace(/\s+/g, ' ').trim()
    }
    if (!text && !bgWords.length) continue

    const time = begin ?? (words[0]?.time ?? null)
    const line = {
      time: time != null && words[0] ? Math.min(time, words[0].time) : time,
      end: endAttr ?? (words.length ? words[words.length - 1].end : null),
      endStated: endAttr != null || words.length > 0,
      text,
      words,
    }
    if (bgWords.length) {
      line.bgWords = bgWords
      line.bgText = joinUnits(bgWords)
    }
    const agent = attr(p, 'agent')
    if (agent) line.agent = agent
    const key = attr(p, 'key')
    if (key) line.key = key
    lines.push(line)
  }

  lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
  return {
    lines,
    timing,
    language,
    agents,
    translations: readTranslations(doc),
    transliterations: readTransliterations(doc),
  }
}

module.exports = { parseTTML }
