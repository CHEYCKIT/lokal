import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { withOutroBreak, MIN_BREAK_S, focusRow } from '../src/lyrics/timing.js'
import { createBreakDots } from '../src/lyrics/breakDots.js'

const word = (w, time, end) => ({ word: w, time, end, space: true })
const timed = (text, time, end) => ({ time, end, text, words: [word(text, time, end)] })
const stamped = (text, time, end = null) => ({ time, end, endStated: end != null, text, words: [] })

const SONG = [timed('first', 10, 14), timed('last', 90, 100)]

test('a song that carries on after the lyrics gets a break until its end', () => {
  const out = withOutroBreak(SONG, { duration: 160 })
  assert.equal(out.length, 3)
  assert.deepEqual(out[2], { time: 100, end: 160, text: '', words: [], gap: true, outro: true })
  assert.equal(SONG.length, 2)
})

test('the crossfade is taken off the end, since the next song takes over then', () => {
  assert.equal(withOutroBreak(SONG, { duration: 160, crossfade: 6 })[2].end, 154)
  assert.equal(withOutroBreak(SONG, { duration: 160, crossfade: 12 })[2].end, 148)
  assert.equal(withOutroBreak(SONG, { duration: 160, crossfade: 0.5 })[2].end, 160)
  assert.equal(withOutroBreak(SONG, { duration: 160, crossfade: 0 })[2].end, 160)
})

test('a short tail, or one the crossfade eats, is not worth dots', () => {
  assert.equal(withOutroBreak(SONG, { duration: 100 + MIN_BREAK_S - 0.1 }), SONG)
  assert.equal(withOutroBreak(SONG, { duration: 100 + MIN_BREAK_S }).length, 3)
  assert.equal(withOutroBreak(SONG, { duration: 108, crossfade: 6 }), SONG)
  assert.equal(withOutroBreak(SONG, { duration: 90 }), SONG)
})

test('lyrics that never say when singing stopped are left alone', () => {
  const lrc = [stamped('one', 10), stamped('two', 90)]
  assert.equal(withOutroBreak(lrc, { duration: 160 }), lrc)
  const withEndStamp = [stamped('one', 10), stamped('two', 90, 100)]
  const out = withOutroBreak(withEndStamp, { duration: 160 })
  assert.equal(out[2].time, 100)
  assert.equal(out[2].end, 160)
})

test('nothing is added when it makes no sense', () => {
  assert.equal(withOutroBreak(SONG, { duration: 160, synced: false }), SONG)
  assert.equal(withOutroBreak(SONG, {}), SONG)
  assert.equal(withOutroBreak(SONG, { duration: 0 }), SONG)
  assert.equal(withOutroBreak(SONG, { duration: NaN }), SONG)
  assert.deepEqual(withOutroBreak([], { duration: 160 }), [])
  const endsInBreak = [...SONG, { time: 100, end: 150, text: '', words: [], gap: true }]
  assert.equal(withOutroBreak(endsInBreak, { duration: 160 }), endsInBreak)
  const untimed = [timed('a', 10, 12), { text: 'b', words: [] }]
  assert.equal(withOutroBreak(untimed, { duration: 160 }), untimed)
})

test('a backing vocal that rings on past the last line starts the break later', () => {
  const lines = [timed('first', 10, 14), { ...timed('last', 90, 100), bgText: 'oh', bgWords: [word('oh', 99, 104)] }]
  assert.equal(withOutroBreak(lines, { duration: 160 })[2].time, 104)
})

test('the panel moves onto the break when the last line stops, and uses the crossfade', () => {
  const lines = withOutroBreak(SONG, { duration: 160, crossfade: 6 })
  assert.equal(focusRow(lines, 99), 1)
  assert.equal(focusRow(lines, 100.5), 2)
  const panel = fs.readFileSync(new URL('../src/components/LyricsPanel.jsx', import.meta.url), 'utf8')
  assert.match(panel, /withOutroBreak\(result\?\.lines \|\| \[\], \{ duration: track\?\.duration, crossfade: crossfadeSeconds/)
})

test('the dots are gone by the time the next song takes over', () => {
  const [, , gap] = withOutroBreak(SONG, { duration: 160, crossfade: 6 })
  const model = createBreakDots()
  const end = gap.end - 0.05
  let frame
  for (let t = gap.time - 0.02; t <= gap.end - 0.02; t += 1 / 60) frame = model.step(t, 1 / 60, { start: gap.time, end })
  assert.ok(frame.dots.every(d => d.r < 1.5 && d.b < 0.2), 'nothing left to see at the handover')
  let early
  const mid = createBreakDots()
  for (let t = gap.time - 0.02; t <= gap.time + 30; t += 1 / 60) early = mid.step(t, 1 / 60, { start: gap.time, end })
  assert.ok(early.dots.every(d => d.r > 5), 'still going well into a long outro')
})
