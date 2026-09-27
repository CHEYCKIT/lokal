// The one lyrics shape every provider is converted into, and every view reads.
//
// Times are in SECONDS (floats), like the player's own progress.
//
// Line:
//   time      start of the line
//   end       when its singing stops, or null when the source never said
//             (line-synced LRC only stamps starts; see hasKnownEnd)
//   text      the line as displayed
//   words     timed units, in order: { word, time, end, space }
//             A unit is whatever the source timed -- a whole word, or one
//             syllable of one ("e" + "nough", or 夢 + なら + ば). `space` says
//             whether a space follows it, which is how syllables of one word
//             are told apart from separate words. Empty for line-synced lines.
//   bgText / bgWords   the answering (background) vocal, same shape, drawn
//             under the lead on its own clock
//   agent     which voice sang it (TTML/LyricsPlus), side 'start' | 'end'
//   key       the line's id in its source document (Apple's L1, L2...)
//   gap       true for an instrumental break marker (text is '')
//   translation / romanization   filled from the source document when it
//             carried them (Apple's own), else attached on demand
//
// Result:
//   { type: 'synced' | 'unsynced' | 'instrumental', sync: 'syllable' | 'line' | 'none',
//     lines, source, isrc?, language?, embedded?: { translations, transliterations } }

function round3(n) { return Math.round(n * 1000) / 1000 }

/** TTML/LRC clock values: "27.395", "1:05.20", "1:02:03.4", "12.3s", "450ms". */
function clockToSeconds(value) {
  if (value === undefined || value === null) return null
  const v = String(value).trim()
  if (!v) return null
  if (/^[\d.]+ms$/.test(v)) return round3(parseFloat(v) / 1000)
  if (/^[\d.]+s$/.test(v)) return round3(parseFloat(v))
  const parts = v.split(':')
  let seconds = 0
  for (const part of parts) {
    const n = parseFloat(part)
    if (!Number.isFinite(n)) return null
    seconds = seconds * 60 + n
  }
  return round3(seconds)
}

function unit(word, time, end, space = false) {
  return { word, time: time == null ? null : round3(time), end: end == null ? null : round3(end), space: !!space }
}

/** Display text for a list of units, honouring each unit's own spacing. */
function joinUnits(units) {
  let out = ''
  units.forEach((u, i) => {
    out += u.word
    if (u.space && i < units.length - 1) out += ' '
  })
  return out.replace(/\s+/g, ' ').trim()
}

/** Splits whitespace-carrying text into { core, lead, trail } so spacing can move onto flags. */
function spacing(text) {
  const lead = /^\s/.test(text)
  const trail = /\s$/.test(text)
  return { core: text.trim(), lead, trail }
}

function isCjk(text) {
  return /[぀-ヿ㐀-鿿豈-﫿가-힯ᄀ-ᇿ]/.test(text || '')
}

function lineText(line) {
  if (!line) return ''
  if (typeof line.text === 'string' && line.text.trim()) return line.text.trim()
  if (Array.isArray(line.words) && line.words.length) return joinUnits(line.words)
  return ''
}

/** Whether anything told us when the singing stops (word timings, or a stated line end). */
function hasKnownEnd(line) {
  return (Array.isArray(line.words) && line.words.length > 0) || (line.end != null && line.endStated === true)
}

function lineEnd(line) {
  const lead = line.words?.length ? line.words[line.words.length - 1].end : (line.endStated ? line.end : line.time)
  const bg = line.bgWords?.length ? line.bgWords[line.bgWords.length - 1].end : null
  return Math.max(lead ?? line.time ?? 0, bg ?? 0)
}

module.exports = { clockToSeconds, unit, joinUnits, spacing, isCjk, lineText, hasKnownEnd, lineEnd, round3 }
