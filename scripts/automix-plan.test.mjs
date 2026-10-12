import test from 'node:test'
import assert from 'node:assert/strict'
import { planTransition, albumContinues, matchRate, tempoOf } from '../src/audio/automix.js'

const analysis = (over = {}) => ({ duration: 200, leadIn: 0.4, audibleEnd: 198, fadeOutStart: 197, energy: 0.7, intro: -2, outro: -1, bpm: 124, beatConfidence: 0.6, firstBeat: 0.2, key: 0, mode: 1, ...over })

test('songs of one album in order play as made (unless asked to mix them)', () => {
  const a = { album: 'Discovery', artist: 'Daft Punk', track_num: 1 }
  const b = { album: 'Discovery', artist: 'Daft Punk', track_num: 2 }
  assert.equal(albumContinues(a, b), true)
  assert.equal(albumContinues(a, { ...b, track_num: 5 }), false)
  assert.equal(albumContinues(a, { ...b, album: 'Homework' }), false)
  assert.equal(planTransition({ out: analysis(), outTrack: a, outDuration: 200, next: analysis(), nextTrack: b }), null)
  assert.equal(planTransition({ out: analysis(), outTrack: a, outDuration: 200, next: analysis(), nextTrack: b, sameAlbum: true }).kind, 'beatmatch')
})

test('steady songs at close tempos are beat-matched on the beat grid, with a bass swap', () => {
  const plan = planTransition({ out: analysis({ bpm: 124 }), outTrack: { title: 'a' }, outDuration: 200, next: analysis({ bpm: 120, leadIn: 1.1, firstBeat: 0.3 }), nextTrack: { title: 'b' } })
  assert.equal(plan.kind, 'beatmatch')
  assert.ok(Math.abs(plan.rate - 124 / 120) < 1e-3)
  const beat = 60 / 124
  assert.ok(Math.abs(plan.length - 16 * beat) < 0.01, `16 beats (${plan.length})`)
  // On the grid, ending before the song's audible end.
  const k = (plan.start - 0.2) / beat
  assert.ok(Math.abs(k - Math.round(k)) < 1e-3, 'starts on a beat')
  assert.ok(plan.start + plan.length <= 198 + 1e-6)
  // The next song from its first beat after its 1.1 s of silence (beats every 0.5 s from 0.3).
  assert.ok(Math.abs(plan.inOffset - 1.3) < 1e-3, `in at ${plan.inOffset}`)
  assert.equal(plan.bassSwap, true)
  assert.ok(plan.swapAt > 0 && plan.swapAt < plan.length)
  // Double time counts too: 62 → 124.
  assert.ok(Math.abs(matchRate(124, 62) - 1) < 1e-9)
  assert.equal(matchRate(124, 100), null)
})

test('anything else: a crossfade on the song\'s own fade-out, silence cut', () => {
  // Far apart in tempo, with a 9 s fade-out and 3 s of silence after it.
  const plan = planTransition({ out: analysis({ bpm: 90, audibleEnd: 197, fadeOutStart: 188 }), outTrack: {}, outDuration: 200, next: analysis({ bpm: 140, leadIn: 2 }), nextTrack: {} })
  assert.equal(plan.kind, 'smart')
  assert.equal(plan.start, 188)
  assert.equal(plan.length, 9)
  assert.equal(plan.inOffset, 2)
  assert.equal(plan.rate, 1)
  // A hard ending between songs of very different energy: short.
  const hard = planTransition({ out: analysis({ bpm: 90, energy: 0.9, audibleEnd: 199.5, fadeOutStart: 199.4 }), outTrack: {}, outDuration: 200, next: analysis({ bpm: 70, energy: 0.3 }), nextTrack: {} })
  assert.equal(hard.length, 3)
  assert.equal(hard.start, 196.5)
  // A quiet ballad pair isn't beat-matched even at the same tempo.
  assert.equal(planTransition({ out: analysis({ energy: 0.2 }), outTrack: {}, outDuration: 200, next: analysis({ energy: 0.2 }), nextTrack: {} }).kind, 'smart')
  // Not analysed: an even crossfade over the last 6 s.
  assert.deepEqual(planTransition({ out: null, outTrack: {}, outDuration: 200, next: null, nextTrack: {} }), { kind: 'crossfade', start: 194, length: 6, inOffset: 0, fadeIn: 3, rate: 1, bassSwap: false })
})

test('an imported tempo wins when the analysis agrees with it (octave or triplet readings too)', () => {
  assert.equal(tempoOf({ tempo: 82 }, { bpm: 109.3, beatConfidence: 0.48 }).bpm, 82)
  assert.equal(tempoOf({ tempo: 87 }, { bpm: 174, beatConfidence: 0.2 }).bpm, 87)
  assert.equal(tempoOf({ tempo: 120 }, { bpm: 97, beatConfidence: 0.5 }).bpm, 97)
  assert.equal(tempoOf({}, { bpm: 128, beatConfidence: 0.5 }).bpm, 128)
})
