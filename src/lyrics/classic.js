// The original ("classic") word animation, kept as it was so it stays available
// next to the spring-driven "fluid" one (src/lyrics/motion.js). Settings >
// Lyrics picks between them. Pure maths, no DOM.

import { RISE_S, isBlockScript } from './timing.js'

const smooth = (x) => x * x * (3 - 2 * x)
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const JOINED = /[֐-ࣿיִ-﷿ﹰ-﻿฀-๿ऀ-෿]/ // RTL, Thai, Indic: letters join up

/** 0..1 through a unit's own span. */
export function unitProgress(u, t) {
  if (t <= u.time) return 0
  if (t >= u.end) return 1
  return (t - u.time) / Math.max(0.001, u.end - u.time)
}

/** How far a unit has lifted: up from its start, back down after its end. 0..1 */
export function unitLift(u, t) {
  const rising = clamp01((t - u.time) / RISE_S)
  const falling = clamp01(1 - (t - u.end) / RISE_S)
  return smooth(Math.min(rising, falling))
}

// ---------------------------------------------------------------- held notes
//
// A word held long enough is animated a letter at a time: each letter swells,
// lifts and glows in turn, so the movement travels along the word instead of
// the whole thing pulsing. Short words need to be held proportionally longer
// to qualify -- a two-letter word held for a second is a held note, a seven-
// letter word sung over the same second is just ordinary pace.

export function canGrowClassic(u) {
  const letters = Array.from(u.word || '')
  const n = letters.length
  if (!n || n > 7 || u.word.includes('-') || isBlockScript(u.word) || JOINED.test(u.word)) return false
  const held = u.end - u.time
  if (n === 1) return held >= 1.1
  if (n <= 3) return held >= 1.3 + (n - 2) * 0.15
  if (n === 4) return held >= 1.05
  return held >= 0.9 && held >= n * 0.2
}

const plans = new WeakMap()

/** A per-letter animation plan for a held word; cached per unit object. */
export function growLetters(u) {
  let plan = plans.get(u)
  if (plan) return plan
  const n = Math.max(1, Array.from(u.word).length)
  const held = Math.max(0.001, u.end - u.time)
  // How much of the full treatment this word earns -- steep, so only a real
  // held note gets most of it and anything barely qualifying stays subtle.
  const earned = Math.pow(clamp01((held - 0.4) / 2.6), 2)
  const stagger = 0.09
  const span = 1.5
  const peaks = Array.from({ length: n }, (_, i) => {
    const place = n > 1 ? i / (n - 1) : 0
    const reach = earned * (1 - place * 0.45)
    const scale = 1 + (n <= 3 ? 0.05 : 0.04) + reach * 0.08
    const centre = (i + 0.5) / n
    return {
      scale,
      rise: (scale - 1) * 0.9 * Math.min(1, Math.max(0.3, held / 2)),
      shift: (centre - 0.5) * 2 * (scale - 1) * 0.55,
      bloom: (0.35 + reach * 0.45) * Math.min(1.1, held / 1.5),
    }
  })
  plan = {
    sample(i, t) {
      const peak = peaks[Math.min(i, n - 1)]
      // Lighting: each letter owns an equal share of the word's span.
      const lit = clamp01((t - u.time) / held * n - i)
      const elapsed = t - u.time - i * held * stagger
      const phase = clamp01(elapsed / (held * span))
      let k
      if (phase < 0.25) k = smooth(phase / 0.25)
      else if (phase < 0.3) k = 1
      else if (phase < 0.75) k = 1 - smooth((phase - 0.3) / 0.45)
      else k = 0
      if (elapsed <= 0) k = 0
      // Every letter keeps the ordinary sung-word lift underneath the swell.
      const base = 0.06 * unitLift(u, t)
      return {
        lit,
        scale: 1 + (peak.scale - 1) * k,
        rise: base + peak.rise * k,
        shift: peak.shift * k,
        bloom: peak.bloom * k,
      }
    },
  }
  plans.set(u, plan)
  return plan
}

