// Timing maths for the lyrics view. Pure functions, no DOM, so they can be
// unit-tested and shared by every place lyrics are drawn.
//
// Units are the timed pieces a line is made of ({ word, time, end, space }):
// a whole word, or one syllable of one. See electron/lyrics/model.js.

import { isHeld } from './motion.js'

/** How long a finished line keeps being repainted so its words can ease back (s). */
export const RISE_S = 0.7

const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯ᄀ-ᇿ]/
const JOINED = /[֐-ࣿיִ-﷿ﹰ-﻿฀-๿ऀ-෿]/ // RTL, Thai, Indic: letters join up

export function isBlockScript(text) { return CJK.test(text || '') }

/** When a line's singing (lead or backing) actually stops. */
export function lineEndOf(line) {
  const lead = line.words?.length ? line.words[line.words.length - 1].end : (line.endStated || line.gap ? line.end : null)
  const bg = line.bgWords?.length ? line.bgWords[line.bgWords.length - 1].end : null
  return Math.max(lead ?? line.time ?? 0, bg ?? 0)
}

/** A break shorter than this isn't drawn (same threshold the lyrics post-processing uses). */
export const MIN_BREAK_S = 4
/** The player only crossfades when it is set above this. */
const CROSSFADE_MIN_S = 0.5

function knowsEnd(line) {
  return !!(line.words?.length || line.bgWords?.length || line.endStated === true)
}

/**
 * The break after the last sung line, for songs that carry on once the lyrics
 * stop (lyrics end at 1:40, the song at 2:40). The post-processing can't draw
 * it, because it doesn't know how long the song is; the panel does.
 *
 * It runs from when the singing actually stopped to when the song hands over:
 * the end of the track, less the crossfade, because with a crossfade the next
 * song takes over (and these lyrics leave) that many seconds before the file
 * ends. Like every other break it needs the last line to say when it stopped
 * (word timings, or a stated end such as a trailing LRC stamp); line-synced
 * lyrics that only stamp starts are left alone. Returns `lines` itself when
 * there is nothing to add.
 */
export function withOutroBreak(lines, { duration, crossfade = 0, synced = true } = {}) {
  if (!synced || !Array.isArray(lines) || !lines.length) return lines
  const total = Number(duration)
  if (!Number.isFinite(total) || total <= 0) return lines
  const sung = lines.filter(l => l && !l.gap)
  const last = sung[sung.length - 1]
  if (!last || last.time == null || !knowsEnd(last) || lines[lines.length - 1].gap) return lines
  const start = sung.reduce((latest, l) => Math.max(latest, lineEndOf(l)), 0)
  const fade = Number(crossfade) > CROSSFADE_MIN_S ? Number(crossfade) : 0
  const end = total - fade
  if (!(start > last.time) || end - start < MIN_BREAK_S) return lines
  const round3 = n => Math.round(n * 1000) / 1000
  return [...lines, { time: round3(start), end: round3(end), text: '', words: [], gap: true, outro: true }]
}

/** The line the view is centred on: the last one whose start has passed. */
export function focusRow(lines, t) {
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    const time = lines[i].time
    if (time == null) continue
    if (time <= t) idx = i
    else break
  }
  return idx
}

/**
 * Every line that needs painting this frame: the focused line, plus any
 * earlier line still being sung (overlapping vocals, a backing line that runs
 * past the next line's start), plus the short settle after each ends.
 */
export function activeRows(lines, t) {
  const latest = focusRow(lines, t)
  if (latest < 0) return []
  const out = []
  const from = Math.max(0, latest - 6)
  for (let i = from; i <= latest; i++) {
    const line = lines[i]
    if (i === latest) { out.push(i); continue }
    if (line.gap) continue
    if (line.time <= t && t < lineEndOf(line) + RISE_S) out.push(i)
  }
  return out
}

/**
 * Lines that should stay fully lit next to the focused one: only those whose
 * singing genuinely hasn't finished yet -- a backing vocal running past the
 * next line's start, overlapping voices. No settle tail, and never a line
 * with no known end (line-synced LRC): those hand over the instant focus
 * moves, in one movement, rather than holding on and then fading.
 */
export function stillSinging(lines, t, focus) {
  const out = []
  for (let i = Math.max(0, focus - 6); i < focus; i++) {
    const line = lines[i]
    if (!line || line.gap || line.time == null || line.time > t) continue
    const hasEnd = (line.words?.length || line.bgWords?.length || line.endStated)
    if (hasEnd && t < lineEndOf(line)) out.push(i)
  }
  return out
}

/**
 * Consecutive units that make one word are kept together so a line never
 * wraps mid-word. CJK has no spaces, so there every unit may break on its own.
 */
export function groupUnits(units) {
  const groups = []
  let current = null
  units.forEach((unit, index) => {
    if (!current) { current = { units: [], space: false }; groups.push(current) }
    current.units.push({ unit, index })
    const next = units[index + 1]
    const breakHere = unit.space || !next || isBlockScript(unit.word) || isBlockScript(next.word)
    if (breakHere) { current.space = !!unit.space; current = null }
  })
  return groups
}

// ---------------------------------------------------------------- held notes
//
// A syllable held long enough is animated a letter at a time (see motion.js):
// each letter swells, lifts and glows in turn, so the movement travels along
// the word instead of the whole thing pulsing.

export function canGrow(u) {
  return isHeld(u, JOINED.test(u.word || ''))
}

/** True when any line carries letters outside the Latin script (so romanization means something). */
export function hasNonLatin(lines) {
  return (lines || []).some(l => /[^\u0000-ɏḀ-ỿ\s\p{P}\p{N}\p{S}]/u.test(`${l.text || ''}${l.bgText || ''}`))
}
