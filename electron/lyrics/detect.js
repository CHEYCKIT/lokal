// Any lyrics blob -> parsed lines, whatever it turns out to be.
//
// Smaller providers wrap the same lyric string in one or two JSON envelopes,
// escape their TTML, or answer "lyrics not found" as a 200 with a text body.
// This unwraps and sniffs so each provider only has to hand over the body.

const { parseTTML } = require('./ttml')
const { parseLRC, parseEnhancedLRC, parseKaraokeLRC, parsePlain, isEnhanced, isKaraoke } = require('./lrc')

const CONTENT_KEYS = ['ttml', 'ttmlContent', 'lyrics', 'lrc', 'content', 'text', 'plainLyrics', 'syncedLyrics', 'line', 'lines', 'lyric', 'data', 'result', 'response']

function extract(value) {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 1) {
      try { return extract(JSON.parse(trimmed)) } catch { /* not JSON */ }
    }
    return trimmed
  }
  if (Array.isArray(value)) {
    const parts = value.map(extract).filter(Boolean)
    return parts.length ? parts.join('\n') : null
  }
  if (typeof value === 'object') {
    if (value.isError === true || value.ok === false || (value.error && value.error !== false && value.error !== '')) return null
    for (const key of CONTENT_KEYS) {
      if (value[key] != null) {
        const found = extract(value[key])
        if (found) return found
      }
    }
  }
  return null
}

function unwrap(raw) {
  let value = String(raw || '').replace(/﻿/g, '').trim()
  if (value.startsWith('```')) value = value.split('\n').slice(1).filter((l, i, a) => !(i === a.length - 1 && l.trim() === '```')).join('\n').trim()
  if (!value) return null
  if (value.startsWith('{') || value.startsWith('[')) {
    try { return extract(JSON.parse(value)) } catch { return value }
  }
  return value
}

function unescapeTtml(value) {
  if (!/&lt;tt[\s&]/i.test(value)) return value
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
}

const NOT_FOUND = /\b(?:lyrics? (?:not found|unavailable)|no lyrics|not found)\b/i

/**
 * Returns { lines, doc } where doc carries TTML extras (agents, translations,
 * transliterations, language, timing), or null when nothing usable came back.
 */
function parseAny(raw) {
  const unwrapped = unwrap(raw)
  if (!unwrapped) return null
  const content = unescapeTtml(unwrapped)

  if (/<tt[\s>]/i.test(content) || content.includes('http://www.w3.org/ns/ttml')) {
    const doc = parseTTML(content)
    if (!doc || !doc.lines.length) return null
    return { lines: doc.lines, doc }
  }
  if (isKaraoke(content)) {
    const lines = parseKaraokeLRC(content)
    return lines.length ? { lines, doc: null } : null
  }
  if (content.trimStart().startsWith('<')) return null
  if (isEnhanced(content)) {
    const lines = parseEnhancedLRC(content)
    if (lines.length) return { lines, doc: null }
  }
  const lrc = parseLRC(content)
  if (lrc.some(l => l.text)) return { lines: lrc, doc: null }
  if (content.length < 200 && NOT_FOUND.test(content)) return null
  const plain = parsePlain(content)
  return plain.length ? { lines: plain, doc: null } : null
}

module.exports = { parseAny, unwrap }
