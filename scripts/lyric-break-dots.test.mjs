import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { createBreakDots, DOTS, R0, S0, WIDTH, HEIGHT, wavePeriod, waveAt, targetsAt, OUTRO_S } from '../src/lyrics/breakDots.js'

const START = 10
const END = 22

function play(opts = {}, { start = START, end = END, from = start - 0.02, to = end, fps = 60 } = {}) {
  const model = createBreakDots()
  const dt = 1 / fps
  const frames = []
  for (let t = from; t <= to + 1e-9; t += dt) {
    const f = model.step(t, dt, { start, end, ...opts })
    frames.push({ t, visible: f.visible, alpha: f.alpha, glow: f.glow, dots: f.dots.map(d => ({ ...d })) })
  }
  return frames
}

const at = (frames, t) => frames.reduce((best, f) => (Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best))
const spacing = (f) => (f.dots[DOTS - 1].x - f.dots[0].x) / (DOTS - 1)

test('every value stays finite and inside the drawing box for the whole break', () => {
  for (const fps of [30, 60, 144]) {
    for (const f of play({}, { fps })) {
      assert.ok(f.alpha >= 0 && f.alpha <= 1)
      assert.ok(f.glow >= 0 && f.glow <= 1)
      for (const d of f.dots) {
        for (const v of [d.x, d.y, d.r, d.b]) assert.ok(Number.isFinite(v))
        assert.ok(d.r >= 0 && d.r <= R0 * 1.75)
        assert.ok(d.b >= 0 && d.b <= 1)
        assert.ok(d.x > -10 && d.x < WIDTH + 10)
        assert.ok(d.y > 0 && d.y < HEIGHT)
      }
    }
  }
})

test('the droplets light up one after another across the break', () => {
  const frames = play()
  const early = at(frames, START + 6).dots.map(d => d.b)
  assert.ok(early[0] > early[1] && early[1] > early[2], `lit left to right: ${early}`)
  const late = at(frames, END - 1.2).dots.map(d => d.b)
  assert.ok(late.every(b => b > 0.9), `all lit before the end: ${late}`)
  assert.ok(at(frames, START + 0.8).dots.every(d => d.b < 0.6))
})

test('the break is cut into whole waves that run left to right', () => {
  for (const dur of [4, 7.3, 12, 31.4]) {
    const period = wavePeriod(dur)
    assert.ok(Math.abs(dur / period - Math.round(dur / period)) < 1e-9)
    assert.ok(period > 1.2 && period < 3.7)
  }
  const period = wavePeriod(12)
  const peak = (i) => {
    let best = 0
    let bestAt = 0
    for (let u = 0; u < period; u += period / 400) {
      const w = waveAt(u, period, i)
      if (w > best) { best = w; bestAt = u }
    }
    return bestAt
  }
  assert.ok(peak(0) < peak(1) && peak(1) < peak(2))
})

test('the wave builds as the break goes on', () => {
  const swell = (from, to) => Math.max(...play({}, { from, to }).map(f => Math.max(...f.dots.map(d => d.r))))
  assert.ok(swell(START + 2, START + 4.6) < swell(END - 4.4, END - 1.6))
})

test('the droplets merge into one drip, which swells and evaporates', () => {
  const frames = play()
  const middle = spacing(at(frames, START + 6))
  const merged = Math.min(...frames.filter(f => f.t > END - 0.9 && f.t < END - 0.2).map(spacing))
  assert.ok(merged < middle * 0.25, `merged ${merged} vs ${middle}`)
  const dripAt = frames.filter(f => f.t > END - 0.75 && f.t < END - 0.35)
  assert.ok(dripAt.some(f => f.dots.every(d => d.b > 0.9 && d.r > R0)), 'one lit drip before it goes')
  assert.ok(at(frames, END - 0.02).dots.every(d => d.r < 1.5 && d.b < 0.2))
})

test('the whole sequence is over before the panel hands focus to the next line', () => {
  const lead = 0.3
  const panel = fs.readFileSync(new URL('../src/components/LyricsPanel.jsx', import.meta.url), 'utf8')
  assert.match(panel, /exitLead = line\.outro \? 0\.05 : FOCUS_LEAD_S/)
  assert.match(panel, /end=\{breakEnd - exitLead\}/)
  const frames = play({}, { end: END - lead - 0.04, to: END })
  const stillThere = frames.filter(f => f.t >= END - lead && f.visible).flatMap(f => f.dots.map(d => d.r))
  assert.ok(stillThere.length === 0 || Math.max(...stillThere) < 0.5)
})

test('nothing shows outside the break', () => {
  const model = createBreakDots()
  assert.equal(model.step(START - 1, 0.016, { start: START, end: END }).visible, false)
  assert.equal(model.step(START + 3, 0.016, { start: START, end: END }).visible, true)
  assert.equal(model.step(END + 1, 0.016, { start: START, end: END }).visible, false)
  assert.equal(model.step(5, 0.016, { start: 8, end: 8 }).visible, false)
})

test('the droplets come out of one blob and part', () => {
  const frames = play()
  assert.ok(spacing(at(frames, START + 0.1)) < S0 * 0.4)
  assert.ok(spacing(at(frames, START + 1.6)) > S0 * 0.9)
  assert.ok(at(frames, START + 0.01).alpha < 0.2)
})

test('seeking inside a break lands in the right state without a lurch', () => {
  const model = createBreakDots()
  const opts = { start: START, end: END }
  model.step(START + 2, 0.016, opts)
  const jumped = model.step(START + 9, 0.016, opts)
  const direct = createBreakDots().step(START + 9, 0.016, opts)
  jumped.dots.forEach((d, i) => {
    assert.ok(Math.abs(d.r - direct.dots[i].r) < 1e-9)
    assert.ok(Math.abs(d.x - direct.dots[i].x) < 1e-9)
    assert.ok(Math.abs(d.b - direct.dots[i].b) < 1e-9)
  })
  const back = model.step(START + 1, 0.016, opts)
  assert.ok(back.dots.every(d => d.b < 0.6))
})

test('a stalled frame or a paused clock cannot blow the physics up', () => {
  const model = createBreakDots()
  const opts = { start: START, end: END }
  model.step(START + 4, 0.016, opts)
  for (let i = 0; i < 40; i++) {
    const f = model.step(START + 4.2, 5, opts)
    f.dots.forEach(d => assert.ok(Number.isFinite(d.r) && d.r <= R0 * 1.75))
  }
  const before = model.step(START + 5, 0.016, opts).dots.map(d => d.r)
  const settled = []
  for (let i = 0; i < 120; i++) settled.push(model.step(START + 5, 0.016, opts).dots.map(d => d.r))
  const last = settled[settled.length - 1]
  const prev = settled[settled.length - 2]
  last.forEach((r, i) => assert.ok(Math.abs(r - prev[i]) < 0.01, 'paused droplets come to rest'))
  assert.ok(before.every(Number.isFinite))
})

test('extra pulse times send a ripple down the chain', () => {
  const calm = play({}, { from: START + 5, to: START + 5.5 })
  const pulsed = play({ pulses: [START + 5.2] }, { from: START + 5, to: START + 5.5 })
  const deviation = pulsed.reduce((m, f, i) => Math.max(m, ...f.dots.map((d, k) => Math.abs(d.r - calm[i].dots[k].r) + Math.abs(d.y - calm[i].dots[k].y) * 0.1)), 0)
  assert.ok(deviation > 0.8, `pulse moved the droplets by ${deviation}`)
})

test('reduced motion keeps the progress but not the movement', () => {
  const frames = play({ calm: true })
  const ys = frames.flatMap(f => f.dots.map(d => d.y))
  assert.ok(Math.max(...ys) - Math.min(...ys) < 0.5)
  const radii = frames.filter(f => f.t > START + 2 && f.t < END - 1).flatMap(f => f.dots.map(d => d.r))
  assert.ok(Math.max(...radii) < R0 * 1.15)
  const lit = at(frames, START + 3.5).dots.map(d => d.b)
  assert.ok(lit[0] > lit[2])
})

test('short breaks still play start to finish', () => {
  const frames = play({}, { start: 0, end: 4, from: -0.02, to: 4 })
  assert.ok(frames.every(f => f.dots.every(d => Number.isFinite(d.r))))
  assert.ok(at(frames, 1.5).dots.every(d => d.r > 5))
  assert.ok(at(frames, 3.98).dots.every(d => d.r < 1.5))
  const t = targetsAt(2, 0, 4)
  assert.ok(t.progress > 0.2 && t.progress < 0.8)
})
