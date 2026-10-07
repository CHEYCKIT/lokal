// The three dots of a lyric break, as droplets of liquid.
//
// Pure maths, no DOM: `createBreakDots()` returns a model that is stepped with
// the song clock and the break's own timing ({ start, end } in seconds, as the
// lyrics post-processing gives every instrumental gap, from TTML, LRC or JSON).
// It answers with where each droplet is, how big, how bright. The component
// (components/LyricBreakDots.jsx) only draws that.
//
// Every droplet is a damped spring on its radius, height and position, and
// neighbours pull on each other (surface tension), so a push on one droplet
// travels along the chain as a wave. Timing drives that physics:
//   enter       the droplets leave one blob and part
//   fill        they light left to right across the break
//   wave        an energy wave runs through them, a whole number of times per
//               break, stronger as the break goes on (and extra `pulses`, e.g.
//               beat times, each send a ripple of their own)
//   anticipate  they pull together into one glowing drip as the vocal is about to return
//   release     the drip swells, lifts and evaporates; it is gone at `end`
//
// `end` is when the droplets must be gone, not when the vocal returns: the
// lyrics panel hands focus to the next line a little before that (the row
// collapses), so callers pass the break's end minus that lead.

export const DOTS = 3
export const R0 = 10
export const S0 = 30
export const PAD = 22
export const WIDTH = PAD * 2 + (DOTS - 1) * S0
export const HEIGHT = 56
export const CY = HEIGHT / 2 + 2

export const ENTER_S = 0.7
export const ANTICIPATE_S = 0.75
export const OUTRO_S = 0.3
const RELEASE_LEAD_S = 0.06

const MAX_SCALE = 1.75
const Y_MIN = -13
const Y_MAX = 9
const STEP_S = 1 / 120
const JUMP_S = 0.45

const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v)
const smooth = (x) => { const c = clamp(x); return c * c * (3 - 2 * c) }
const mid = (DOTS - 1) / 2

/** Seconds per wave: the break is cut into a whole number of waves of about 2.4s. */
export function wavePeriod(duration) {
  const d = Math.max(0.001, duration)
  return d / Math.max(1, Math.round(d / 2.4))
}

/** How hard the wave is lifting droplet `i` (0..1) `u` seconds into the break. */
export function waveAt(u, period, i, sigma = 0.2) {
  const phase = (((u / period) % 1) + 1) % 1
  const front = phase * (1 + 2 * sigma) - sigma
  const d = (front - (i + 0.5) / DOTS) / sigma
  return Math.exp(-d * d)
}

/** The shape the droplets are pulled toward at time t. Everything the physics chases. */
export function targetsAt(t, start, end, { calm = false } = {}) {
  const dur = Math.max(0.001, end - start)
  const u = t - start
  const rem = end - t
  const outro = Math.min(OUTRO_S, dur * 0.2)
  const anticipate = Math.min(ANTICIPATE_S, dur * 0.25)
  const enter = smooth(u / ENTER_S)
  const fillFrom = ENTER_S * 0.5
  const fillTo = Math.max(fillFrom + 0.2, dur - outro - anticipate * 0.6)
  const progress = clamp((u - fillFrom) / (fillTo - fillFrom))
  const energy = 0.4 + 0.6 * smooth(progress)
  const grip = calm ? 0 : smooth((outro + RELEASE_LEAD_S + anticipate - rem) / anticipate)
  const release = calm ? 0 : clamp(1 - (rem - RELEASE_LEAD_S) / outro)
  const period = wavePeriod(dur)

  const out = { alpha: smooth(u / 0.22), progress, grip, release, energy, s: [], y: [], x: [], b: [] }
  for (let i = 0; i < DOTS; i++) {
    const lit = smooth(progress * DOTS - i)
    const leaving = calm ? 0 : smooth(clamp(release * 1.25 - i * 0.08))
    const pulse = calm ? 0 : waveAt(u, period, i) * energy * (1 - grip) * enter
    const spread = (0.15 + 0.85 * enter) * (1 - 0.92 * grip) * (1 + 0.6 * leaving)
    out.s.push((0.78 + 0.22 * lit + 0.42 * pulse) * (1 + 0.3 * grip) * (1 - leaving))
    out.y.push(-9 * pulse + 4 * grip - 13 * leaving)
    out.x.push((i - mid) * S0 * spread)
    const glowing = 0.3 + 0.7 * lit
    out.b.push((glowing + (1 - glowing) * grip) * (1 - leaving))
  }
  return out
}

/**
 * A droplet chain. Call `step(t, dt, { start, end, pulses?, calm? })` once per
 * frame with the song clock; it returns the same frame object each time:
 *   { visible, alpha, glow, dots: [{ x, y, r, b }] }   (x, y, r in a WIDTH x HEIGHT box)
 */
export function createBreakDots() {
  const state = {
    s: Array(DOTS).fill(0), sv: Array(DOTS).fill(0),
    y: Array(DOTS).fill(0), yv: Array(DOTS).fill(0),
    x: Array(DOTS).fill(0), xv: Array(DOTS).fill(0),
    b: Array(DOTS).fill(0),
    t: null, popped: false,
  }
  const frame = { visible: false, alpha: 0, glow: 0, dots: Array.from({ length: DOTS }, () => ({ x: 0, y: 0, r: 0, b: 0 })) }

  function snap(tg) {
    for (let i = 0; i < DOTS; i++) {
      state.s[i] = tg.s[i]; state.sv[i] = 0
      state.y[i] = tg.y[i]; state.yv[i] = 0
      state.x[i] = tg.x[i]; state.xv[i] = 0
      state.b[i] = tg.b[i]
    }
  }

  function integrate(tg, h) {
    const { s, sv, y, yv, x, xv } = state
    for (let i = 0; i < DOTS; i++) {
      const sl = s[i > 0 ? i - 1 : i]
      const sr = s[i < DOTS - 1 ? i + 1 : i]
      const yl = y[i > 0 ? i - 1 : i]
      const yr = y[i < DOTS - 1 ? i + 1 : i]
      sv[i] = clamp(sv[i] + (-220 * (s[i] - tg.s[i]) - 8.9 * sv[i] + 60 * (sl + sr - 2 * s[i])) * h, -60, 60)
      yv[i] = clamp(yv[i] + (-150 * (y[i] - tg.y[i]) - 9.3 * yv[i] + 40 * (yl + yr - 2 * y[i])) * h, -400, 400)
      xv[i] = clamp(xv[i] + (-130 * (x[i] - tg.x[i]) - 13.7 * xv[i]) * h, -400, 400)
    }
    for (let i = 0; i < DOTS; i++) {
      s[i] = clamp(s[i] + sv[i] * h, -0.2, MAX_SCALE + 0.4)
      y[i] = clamp(y[i] + yv[i] * h, Y_MIN - 6, Y_MAX + 6)
      x[i] += xv[i] * h
    }
  }

  function step(t, dt, { start, end, pulses = null, calm = false } = {}) {
    const rem = end - t
    const outro = Math.min(OUTRO_S, Math.max(0.001, end - start) * 0.2)
    const popAt = outro * 0.9 + RELEASE_LEAD_S
    if (!(end > start) || t < start - 0.05 || rem < -0.05) {
      state.t = null
      state.popped = false
      frame.visible = false
      frame.alpha = 0
      frame.glow = 0
      return frame
    }
    const tg = targetsAt(t, start, end, { calm })
    const jumped = state.t == null || Math.abs(t - state.t) > JUMP_S || t < state.t - 0.05
    if (jumped) {
      snap(tg)
      state.popped = rem <= popAt
    } else {
      if (!calm) {
        if (Array.isArray(pulses)) {
          for (const pt of pulses) {
            if (pt > state.t && pt <= t && pt > start && pt < end - outro) { state.sv[0] += 6; state.yv[0] -= 55 }
          }
        }
        if (!state.popped && rem <= popAt) {
          state.popped = true
          for (let i = 0; i < DOTS; i++) { state.sv[i] += 5 + i * 1.2; state.yv[i] -= 90; state.xv[i] += (i - mid) * 60 }
        }
      }
      const span = clamp(dt, 0, 0.1)
      const steps = Math.max(1, Math.ceil(span / STEP_S))
      for (let k = 0; k < steps; k++) integrate(tg, span / steps || STEP_S)
      const ease = 1 - Math.exp(-span * 16)
      for (let i = 0; i < DOTS; i++) state.b[i] += (tg.b[i] - state.b[i]) * ease
    }
    state.t = t

    frame.visible = true
    frame.alpha = tg.alpha
    frame.glow = clamp(0.1 + 0.25 * tg.progress + 0.45 * tg.grip) * (1 - tg.release)
    const cx = WIDTH / 2
    for (let i = 0; i < DOTS; i++) {
      const d = frame.dots[i]
      d.x = cx + state.x[i]
      d.y = CY + clamp(state.y[i], Y_MIN, Y_MAX)
      d.r = R0 * clamp(state.s[i], 0, MAX_SCALE)
      d.b = clamp(state.b[i])
    }
    return frame
  }

  function reset() {
    state.t = null
    state.popped = false
  }

  return { step, reset, state, frame }
}
