import assert from 'node:assert/strict'
import { test } from 'node:test'
import { syncVideo, seekVideo } from '../src/musicVideoPlayback.js'

const segments = [{ start: 0, end: null, offset: 4 }]
function video() {
  return {
    readyState: 1, paused: true, seeking: false, duration: 240, currentTime: 0,
    playCount: 0, pauseCount: 0,
    play() { this.playCount++; this.paused = false; return Promise.resolve() },
    pause() { this.pauseCount++; this.paused = true },
  }
}

test('opening a cached video mid-song starts it at the song time even before canplay', () => {
  const element = video()
  assert.deepEqual(syncVideo(element, { time: 42, segments, isPlaying: true }), { outside: false })
  assert.equal(element.currentTime, 46)
  assert.equal(element.playCount, 1)
  assert.equal(element.pauseCount, 0)
})

test('an in-flight seek is allowed to finish while playback continues', () => {
  const element = video()
  element.seeking = true
  element.currentTime = 50
  syncVideo(element, { time: 60, segments, isPlaying: true })
  assert.equal(element.currentTime, 50)
  assert.equal(element.playCount, 1)
})

for (const playing of [true, false]) {
  test(`seeking preserves the song's ${playing ? 'playing' : 'paused'} state`, () => {
    const element = video()
    const audio = video()
    const state = {
      isPlaying: playing, activeAudioElement: 'primary', audioRef: { current: audio },
      setProgressWithAudioUpdate(time) { audio.currentTime = time },
    }
    seekVideo(90, { state, element, segments })
    assert.equal(audio.currentTime, 90)
    assert.equal(element.currentTime, 94)
    assert.equal(audio.pauseCount, 0)
    assert.equal(audio.playCount, playing ? 1 : 0)
    assert.equal(element.playCount, playing ? 1 : 0)
    assert.equal(state.isPlaying, playing)
  })
}

const streamed = () => Object.assign(video(), { currentSrc: 'lokal-stream://ytv/aaaaaaaaaaa', readyState: 4, paused: false, buffered: { length: 1, start: () => 0, end: () => 30 } })

test('a streamed video sent somewhere not loaded aims a moment ahead, then its frame waits for the song', () => {
  const element = streamed()
  element.currentTime = 20
  syncVideo(element, { time: 60, segments, isPlaying: true })
  assert.equal(element.currentTime, 65, 'one second past the song (64)')
  // Loaded there, the song not yet: held, not sent back into what isn't loaded.
  element.buffered = { length: 1, start: () => 65, end: () => 80 }
  syncVideo(element, { time: 60.3, segments, isPlaying: true })
  assert.equal(element.currentTime, 65)
  assert.equal(element.paused, true)
  // The song catches up: it plays on.
  syncVideo(element, { time: 60.8, segments, isPlaying: true })
  assert.equal(element.paused, false)
})

test('a streamed video still loading where it was sent is not sent again (the request would be thrown away)', () => {
  const element = streamed()
  element.readyState = 2
  element.currentTime = 65
  syncVideo(element, { time: 63, segments, isPlaying: true })
  assert.equal(element.currentTime, 65)
  // Far off (the song itself was moved): sent there.
  syncVideo(element, { time: 120, segments, isPlaying: true })
  assert.equal(element.currentTime, 125)
})

test('a downloaded video in a part not buffered yet goes straight to the song (no lead)', () => {
  const element = Object.assign(video(), { currentSrc: 'file:///videos/a.mp4', readyState: 4, buffered: { length: 0 } })
  syncVideo(element, { time: 60, segments, isPlaying: true })
  assert.equal(element.currentTime, 64)
})
