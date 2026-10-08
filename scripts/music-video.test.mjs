import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { isMusicVideoFor, baseTitle, artistNames, audioFeatures, alignAudio, videoTimeFor, FPS } = require('../electron/online/musicVideo.js')

const track = { title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 }
const video = (fields) => ({ videoId: 'abcdefghijk', kind: 'video', official: true, artists: ['The Weeknd'], artist: 'The Weeknd', duration: 263, ...fields })

test('titles match without video tags and features', () => {
  assert.equal(baseTitle('Blinding Lights (Official Video)'), 'blinding lights')
  assert.equal(baseTitle('Levitating (feat. DaBaby) [4K]'), 'levitating')
  assert.deepEqual(artistNames('Dua Lipa feat. DaBaby & Elton John'), ['dua lipa', 'dababy', 'elton john'])
  assert.deepEqual(artistNames('TaylorSwiftVEVO'), ['taylorswift'])
})

test('only the official video of the same song by the same artist is a match', () => {
  assert.ok(isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)' })))
  assert.ok(isMusicVideoFor(track, video({ title: 'The Weeknd - Blinding Lights (Official Music Video)' })))
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', official: false })), 'not an official upload')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', artists: ['The Sevenights'], artist: 'The Sevenights' })), 'other artist')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Live at SoFi Stadium)' })), 'live')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Lyric Video)' })), 'lyric video')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Remix)' })), 'remix')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Save Your Tears (Official Video)' })), 'other song')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', kind: 'song' })), 'the song itself')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', duration: 120 })), 'shorter than the song')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', duration: 900 })), 'far longer')
  assert.ok(isMusicVideoFor({ ...track, title: 'Blinding Lights - Live' }, video({ title: 'Blinding Lights (Live)' })), 'the song is the live one')
})

// A deterministic "song": noise bursts at irregular onsets.
function song(seconds, seed = 1) {
  const rate = 8000
  const out = new Float32Array(seconds * rate)
  let x = seed
  const random = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648)
  let t = 0
  while (t < out.length) {
    const length = Math.floor(rate * (0.05 + random() * 0.1))
    const level = 0.2 + random() * 0.8
    for (let i = t; i < Math.min(out.length, t + length); i++) out[i] = (random() * 2 - 1) * level * (1 - (i - t) / length)
    t += length + Math.floor(rate * (0.1 + random() * 0.5))
  }
  return out
}

test('finds where the song starts inside a video with an intro', () => {
  const audio = song(90)
  const intro = new Float32Array(8000 * 20).map((_, i) => Math.sin(i / 3) * 0.05) // 20 s of a quiet hum
  const clip = new Float32Array(intro.length + audio.length)
  clip.set(intro)
  clip.set(audio, intro.length)
  const segments = alignAudio(audioFeatures(audio), audioFeatures(clip))
  assert.ok(segments)
  assert.equal(segments.length, 1)
  assert.ok(Math.abs(segments[0].offset - 20) < 1 / FPS, `offset ${segments[0].offset}`)
  assert.ok(Math.abs(videoTimeFor(segments, 30) - 50) < 0.05)
})

test('follows a skit in the middle of the video', () => {
  const audio = song(120, 7)
  const half = 8000 * 60
  const skit = song(15, 99).map(v => v * 0.3)
  const clip = new Float32Array(audio.length + skit.length)
  clip.set(audio.subarray(0, half))
  clip.set(skit, half)
  clip.set(audio.subarray(half), half + skit.length)
  const segments = alignAudio(audioFeatures(audio), audioFeatures(clip))
  assert.ok(segments && segments.length === 2, JSON.stringify(segments))
  assert.ok(Math.abs(videoTimeFor(segments, 10) - 10) < 0.05)
  assert.ok(Math.abs(videoTimeFor(segments, 100) - 115) < 0.05)
})

test('rejects a video whose audio is another song', () => {
  assert.equal(alignAudio(audioFeatures(song(90, 3)), audioFeatures(song(100, 4))), null)
})
