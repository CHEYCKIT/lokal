import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { analyze, RATE } = require('../electron/automix/analysis.js')

/**
 * A made-up song: `lead` s of silence, then a kick on every beat at `bpm`
 * (and a quieter hat between), over a held chord of `notes` (Hz), for
 * `length` s, the last `fade` s fading out, then `tail` s of silence.
 */
function song({ bpm = 120, lead = 2, length = 60, fade = 6, tail = 3, notes = [261.63, 329.63, 392.0] } = {}) {
  const total = Math.round((lead + length + tail) * RATE)
  const pcm = new Float32Array(total)
  const beat = 60 / bpm
  for (let i = 0; i < total; i++) {
    const t = i / RATE - lead
    if (t < 0 || t > length) continue
    const gain = t > length - fade ? (length - t) / fade : 1
    let sample = 0
    for (const f of notes) sample += 0.08 * Math.sin(2 * Math.PI * f * t)
    const sinceBeat = t % beat
    sample += 0.6 * Math.exp(-sinceBeat * 30) * Math.sin(2 * Math.PI * 60 * sinceBeat)
    const sinceHalf = (t + beat / 2) % beat
    sample += 0.15 * Math.exp(-sinceHalf * 80) * (Math.sin(i * 12.9898) * 43758.5453 % 1)
    pcm[i] = sample * gain
  }
  return pcm
}

test('tempo and the beat grid', () => {
  for (const bpm of [96, 120, 128, 140]) {
    const result = analyze(song({ bpm }))
    assert.ok(Math.abs(result.bpm - bpm) < 1.5, `${bpm} BPM read as ${result.bpm}`)
    assert.ok(result.beatConfidence > 0.3, `confident at ${bpm} (${result.beatConfidence})`)
    // The first beat lands on the grid (2 s of silence, then a beat every 60/bpm).
    const period = 60 / bpm
    const off = ((result.firstBeat - 2) % period + period) % period
    assert.ok(Math.min(off, period - off) < 0.06, `beat phase off by ${off.toFixed(3)} s at ${bpm}`)
  }
})

test('where the sound starts, where the outro fades, where it really ends', () => {
  const result = analyze(song({ lead: 2, length: 60, fade: 6, tail: 3 }))
  assert.ok(Math.abs(result.leadIn - 2) < 0.15, `lead-in ${result.leadIn}`)
  assert.ok(result.audibleEnd > 60 && result.audibleEnd < 62.2, `audible end ${result.audibleEnd} (the file runs to 65 s)`)
  assert.ok(result.fadeOutStart > 54 && result.fadeOutStart < 61, `fade-out from ${result.fadeOutStart}`)
  assert.ok(result.duration > 64.9)
  assert.ok(result.energy > 0 && result.energy <= 1)
})

test('key: C major and A minor', () => {
  const major = analyze(song({ notes: [261.63, 329.63, 392.0, 130.81] }))
  assert.equal(major.key, 0)
  assert.equal(major.mode, 1)
  assert.equal(major.camelot, '8B')
  const minor = analyze(song({ notes: [220.0, 261.63, 329.63, 110.0] }))
  assert.equal(minor.key, 9)
  assert.equal(minor.mode, 0)
  assert.equal(minor.camelot, '8A')
})
