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
