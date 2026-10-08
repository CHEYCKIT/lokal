import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Spring, curve, WORD, LETTER, stepWord, stepLetters, isHeld } from '../src/lyrics/motion.js'
import { canGrow } from '../src/lyrics/timing.js'

const unit = (word, time, end) => ({ word, time, end, space: false })

test('a spring converges on its goal for every damping regime', () => {
  for (const damping of [0.3, 0.64, 1, 2.5]) {
    const s = new Spring(0, 1.2, damping)
    s.goal(1)
    for (let i = 0; i < 600; i++) s.step(1 / 60)
    assert.ok(Math.abs(s.p - 1) < 1e-3, `damping ${damping}`)
    assert.ok(s.asleep())
  }
})

test('an underdamped spring overshoots, a critically damped one does not', () => {
  const run = (damping) => {
    const s = new Spring(0, 1, damping)
    s.goal(1)
    let max = 0
    for (let i = 0; i < 300; i++) max = Math.max(max, s.step(1 / 60))
    return max
  }
  assert.ok(run(0.4) > 1.05)
  assert.ok(run(1) <= 1 + 1e-6)
})

test('one big step lands where many small ones do', () => {
  const a = new Spring(0, 0.9, 0.6); a.goal(1); a.step(0.5)
  const b = new Spring(0, 0.9, 0.6); b.goal(1); for (let i = 0; i < 500; i++) b.step(0.001)
  assert.ok(Math.abs(a.p - b.p) < 1e-3)
})

test('snap puts the spring on the goal with no velocity', () => {
  const s = new Spring(0, 1, 0.5)
  s.goal(3, true)
  assert.equal(s.p, 3)
  assert.ok(s.asleep())
})

test('curves pass through their keyframes without exceeding them', () => {
  assert.ok(Math.abs(WORD.scale(0) - 0.95) < 1e-9)
  assert.ok(Math.abs(WORD.scale(0.7) - 1.0505) < 1e-9)
  assert.ok(Math.abs(WORD.scale(1) - 1) < 1e-9)
  const f = curve([[0, 0], [0.15, 1], [0.6, 1], [1, 0]])
  for (let x = 0; x <= 1; x += 0.01) assert.ok(f(x) >= -1e-9 && f(x) <= 1 + 1e-9)
})

test('a sung word swells while it is sung and settles back at rest', () => {
  const u = unit('hello', 10, 10.6)
  let peak = 0
  let last
  for (let t = 9.9; t < 14; t += 1 / 60) {
    last = stepWord(u, t, 1 / 60)
    peak = Math.max(peak, last.scale)
  }
  assert.ok(peak > 1.02)
  assert.ok(Math.abs(last.scale - 1) < 0.002)
  assert.equal(last.fill, 1)
  assert.equal(last.moving, false)
})

test('seeking snaps instead of springing', () => {
  const u = unit('there', 20, 20.5)
  stepWord(u, 5, 1 / 60)
  const w = stepWord(u, 30, 1 / 60, true)
  assert.equal(w.fill, 1)
  assert.ok(Math.abs(w.scale - 1) < 1e-9)
  assert.equal(w.moving, false)
})

test('only syllables held a second or more are split into letters', () => {
  assert.equal(canGrow(unit('oh', 0, 0.9)), false)
  assert.equal(canGrow(unit('oh', 0, 1)), true)
  assert.equal(canGrow(unit('love', 0, 2)), true)
  assert.equal(canGrow(unit('שלום', 0, 2)), false) // joined script
  assert.equal(isHeld(unit('x'.repeat(20), 0, 3)), false)
})

test('the swell travels along a held word, strongest at the active letter', () => {
  const u = unit('stay', 0, 2)
  let steps
  for (let t = 0; t <= 0.9; t += 1 / 60) steps = stepLetters(u, t, 1 / 60)
  // t = 0.9 of a 1.75s letter span over 4 letters: letter 2 is active.
  // Letters already sung are still easing back down (the springs lag), so only
  // the one still to come is a fair comparison.
  assert.ok(steps[2].scale > steps[3].scale)
  assert.ok(steps[3].scale < 1)
  assert.equal(steps[0].fill, 1)
  assert.equal(steps[3].fill, 0)
  assert.ok(steps[2].fill > 0 && steps[2].fill < 1)
})

test('every letter ends the note lit and at rest', () => {
  const u = unit('stay', 0, 2)
  let steps
  for (let t = 0; t <= 6; t += 1 / 60) steps = stepLetters(u, t, 1 / 60)
  for (const s of steps) {
    assert.equal(s.fill, 1)
    assert.ok(Math.abs(s.scale - LETTER.scale(1)) < 0.002)
    assert.equal(s.moving, false)
  }
})

test('quick words bounce less than held ones, and the sweep eases across them', () => {
  const peak = (len) => {
    const u = unit('go', 5, 5 + len)
    let max = 0
    for (let t = 4.9; t < 8; t += 1 / 60) max = Math.max(max, stepWord(u, t, 1 / 60).scale)
    return max
  }
  assert.ok(peak(0.12) < peak(0.6))
  // The sweep lags the word's end slightly, then finishes.
  const u = unit('go', 5, 5.1)
  let atEnd
  let last
  for (let t = 4.95; t <= 5.6; t += 1 / 60) {
    last = stepWord(u, t, 1 / 60)
    if (atEnd === undefined && t >= 5.1) atEnd = last.fill
  }
  assert.ok(atEnd < 1)
  assert.ok(last.fill > 0.999)
})
