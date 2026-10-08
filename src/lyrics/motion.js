// Spring-driven motion for sung words. Pure maths, no DOM, so it can be
// unit-tested and shared by every place lyrics are drawn.
//
// A word does not move *as a function of the clock*: the clock only says where
// each property should be (its goal), and a damped spring chases that goal. The
// spring is what gives the lift its overshoot and settle, and what lets a word
// that has just been sung ease back instead of snapping.
//
//   goal  = curve(progress through the word)      (keyframes below)
//   value = spring(goal) stepped by real frame time
//
// Held syllables are split into letters. Each letter is timed on its own slice
// of the syllable; the one being sung takes the full effect and its neighbours
// follow with a steep falloff, so the swell travels along the word.
//
// Times are in seconds, like the rest of the lyrics code.

// ---------------------------------------------------------------- spring

const TWO_PI = Math.PI * 2
const SLEEP_OFFSET = 1 / 3840
const SLEEP_VELOCITY = 0.01

/** A critically/under/over-damped spring, advanced with the exact closed form (stable at any dt). */
export class Spring {
  constructor(position, frequency, damping) {
    this.p = position
    this.v = 0
    this.g = position
    this.w = frequency * TWO_PI // rad/s
    this.z = damping
  }

  /** Move the goal. `snap` jumps straight there and drops all velocity. */
  goal(g, snap = false) {
    this.g = g
    if (snap) { this.p = g; this.v = 0 }
  }

  step(dt) {
    if (!(dt > 0)) return this.p
    const { w, z, g } = this
    const o = this.p - g
    const v = this.v
    if (z < 1) {
      const wd = w * Math.sqrt(1 - z * z)
      const e = Math.exp(-z * w * dt)
      const cos = Math.cos(wd * dt)
      const sin = Math.sin(wd * dt)
      const b = (v + z * w * o) / wd
      this.p = g + e * (o * cos + b * sin)
      this.v = e * ((wd * b - z * w * o) * cos - (z * w * b + wd * o) * sin)
    } else if (z === 1) {
      const e = Math.exp(-w * dt)
      const c = v + w * o
      this.p = g + e * (o + c * dt)
      this.v = e * (v - w * c * dt)
    } else {
      const s = Math.sqrt(z * z - 1)
      const r1 = -w * (z + s)
      const r2 = -w * (z - s)
      const c2 = (v - r1 * o) / (r2 - r1)
      const c1 = o - c2
      const e1 = Math.exp(r1 * dt)
      const e2 = Math.exp(r2 * dt)
      this.p = g + c1 * e1 + c2 * e2
      this.v = c1 * r1 * e1 + c2 * r2 * e2
    }
    return this.p
  }

  asleep() {
    const o = this.p - this.g
    return this.v * this.v <= SLEEP_VELOCITY * SLEEP_VELOCITY && o * o <= SLEEP_OFFSET * SLEEP_OFFSET
  }
}

// ---------------------------------------------------------------- curves

/**
 * A smooth curve through [x, y] keyframes (x ascending). Cubic Hermite with
 * flat tangents at every turning point, so it passes through each keyframe
 * without overshooting it.
 */
export function curve(points) {
  const n = points.length
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  const slope = []
  for (let i = 0; i < n - 1; i++) slope.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]))
  const m = ys.map((_, i) => {
    if (i === 0) return slope[0]
    if (i === n - 1) return slope[n - 2]
    return slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  })
  return (x) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (x > xs[i + 1]) i++
    const h = xs[i + 1] - xs[i]
    const s = (x - xs[i]) / h
    const s2 = s * s
    const s3 = s2 * s
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * m[i + 1]
  }
}

/** Keyframes by progress through the word (0..1). Y is in em, positive = down. */
export const WORD = {
  scale: curve([[0, 0.95], [0.7, 1.0505], [1, 1]]),
  y: curve([[0, 1 / 100], [0.9, -1 / 60], [1, 0]]),
  glow: curve([[0, 0], [0.15, 1], [0.6, 1], [1, 0]]),
}

/** The same, for one letter of a held syllable: a bolder swell. */
export const LETTER = {
  scale: curve([[0, 0.95], [0.7, 1.175], [1, 1]]),
  y: curve([[0, 1 / 100], [0.9, -1 / 56], [1, 0]]),
  glow: WORD.glow,
}

// How the springs feel: frequency (Hz) and damping ratio. Lower damping = more overshoot.
const FEEL = {
  scale: [0.88, 0.64],
  y: [1.45, 0.4],
  glow: [1.18, 0.56],
}

/** A letter rises twice as far as a whole word. */
const LETTER_LIFT = 2

/** Letters leave this much of the syllable's tail unlit-for-movement so the swell lands before the note ends (s). */
const LETTER_TAIL_S = 0.25
/** After the active letter has passed, letters of a still-sung word keep this much of the glow. */
const SUNG_LETTER_GLOW = 0.2
/** A syllable held at least this long is split into letters (s). */
export const HELD_S = 1.0

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const easeSinOut = (x) => Math.sin(clamp01(x) * Math.PI / 2)

// ---------------------------------------------------------------- per-unit state

function makeSprings(scale0, y0, glow0) {
  return {
    scale: new Spring(scale0, ...FEEL.scale),
    y: new Spring(y0, ...FEEL.y),
    glow: new Spring(glow0, ...FEEL.glow),
  }
}

const states = new WeakMap()

/** The springs for one unit (and, once it is sung as a held note, its letters). */
function stateOf(u) {
  let s = states.get(u)
  if (!s) {
    s = { word: makeSprings(WORD.scale(0), WORD.y(0), WORD.glow(0)), letters: null }
    states.set(u, s)
  }
  return s
}

function lettersOf(u, state) {
  if (!state.letters) {
    const n = Math.max(1, Array.from(u.word).length)
    state.letters = Array.from({ length: n }, () => makeSprings(LETTER.scale(0), LETTER.y(0), LETTER.glow(0)))
  }
  return state.letters
}

function drive(springs, goal, dt, snap) {
  springs.scale.goal(goal.scale, snap)
  springs.y.goal(goal.y, snap)
  springs.glow.goal(goal.glow, snap)
  return {
    scale: springs.scale.step(dt),
    y: springs.y.step(dt),
    glow: springs.glow.step(dt),
    moving: !(springs.scale.asleep() && springs.y.asleep() && springs.glow.asleep()),
  }
}

// ---------------------------------------------------------------- word

/** 0 before the unit, 1 after it, linear through it. */
export function progressOf(u, t) {
  if (t <= u.time) return 0
  if (t >= u.end) return 1
  return (t - u.time) / Math.max(0.001, u.end - u.time)
}

/**
 * Advance one unit's motion to time `t`.
 *   dt    seconds since the previous frame
 *   snap  jump to the goal (a seek, or first paint) instead of springing there
 *
 * Returns { fill, scale, y, glow, moving }: fill is how far the colour sweep has
 * crossed the unit (0..1); y is in em; moving says whether anything is still
 * in motion (so the caller knows when it can stop repainting this unit).
 */
export function stepWord(u, t, dt, snap = false) {
  const s = stateOf(u)
  const p = progressOf(u, t)
  const goal = { scale: WORD.scale(p), y: WORD.y(p), glow: WORD.glow(p) }
  const out = drive(s.word, goal, dt, snap)
  return { fill: p, scale: out.scale, y: out.y, glow: out.glow, moving: out.moving }
}

// ---------------------------------------------------------------- held notes

/** Whether a unit is held long enough to be animated a letter at a time. */
export function isHeld(u, joined = false) {
  const n = Array.from(u.word || '').length
  if (n < 2 || n > 16 || joined) return false
  return u.end - u.time >= HELD_S
}

/**
 * Advance a held unit's letters. Returns an array parallel to
 * Array.from(u.word): { fill, scale, y, glow, moving }.
 */
export function stepLetters(u, t, dt, snap = false) {
  const s = stateOf(u)
  const springs = lettersOf(u, s)
  const n = springs.length
  const start = u.time
  const finish = Math.max(start + 0.001, u.end - LETTER_TAIL_S)
  const slice = (finish - start) / n

  let active = -1
  let activePct = 0
  if (t >= start && t < finish) {
    active = Math.min(n - 1, Math.floor((t - start) / slice))
    activePct = (t - (start + active * slice)) / slice
  }
  const wordSung = t >= u.end

  const rest = { scale: LETTER.scale(0), y: LETTER.y(0), glow: LETTER.glow(0) }
  const done = { scale: LETTER.scale(1), y: LETTER.y(1), glow: LETTER.glow(1) }

  return springs.map((sp, k) => {
    const lStart = start + k * slice
    const lEnd = lStart + slice
    const state = t < lStart ? 'not' : t >= lEnd ? 'sung' : 'active'

    let goal
    if (wordSung) goal = done
    else if (state === 'not') goal = rest
    else if (active !== -1) {
      const d = Math.abs(k - active)
      const near = 1 / (1 + Math.pow(d, 2.8))
      const nearGlow = 1 / (1 + d * 0.9)
      goal = {
        scale: rest.scale + (LETTER.scale(activePct) - rest.scale) * near,
        y: rest.y + (LETTER.y(activePct) - rest.y) * near,
        glow: rest.glow + (LETTER.glow(activePct) - rest.glow) * nearGlow,
      }
    } else {
      // Between the last letter and the end of the note: hold the swell's afterglow.
      goal = { scale: rest.scale, y: rest.y, glow: LETTER.glow(SUNG_LETTER_GLOW) }
    }

    const out = drive(sp, goal, dt, snap)
    const fill = state === 'not' ? 0 : state === 'sung' ? 1 : easeSinOut(clamp01((t - lStart) / slice))
    return { fill, scale: out.scale, y: out.y * LETTER_LIFT, glow: out.glow, moving: out.moving }
  })
}
