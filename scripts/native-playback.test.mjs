import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { NativePlayback } = require('../electron/audio/playback.js')

test('native playback wrapper validates sources and forwards async loads', async () => {
  const calls = []
  const addon = {
    AudioEngine: class {
      load(...args) { calls.push(['load', ...args]); return Promise.resolve(187) }
      status() { return { track_id: 'track', position: 2, duration: 187, playing: true, ended: false } }
      play() { calls.push(['play']) }
      pause() { calls.push(['pause']) }
      stop() { calls.push(['stop']) }
      close() { calls.push(['close']) }
    },
  }
  const wrapper = new NativePlayback(() => addon)
  assert.deepEqual(wrapper.available(), { available: true })
  await assert.rejects(wrapper.loadSource({ trackId: 'track', kind: 'bad', value: 'x' }), /Invalid native audio source/)
  assert.equal(await wrapper.loadSource({ trackId: 'track', kind: 'url', value: 'https://example.test/audio', standby: true }), 187)
  assert.deepEqual(calls[0], ['load', 'track', 'url', 'https://example.test/audio', null, true])
  wrapper.call('play')
  wrapper.call('pause')
  wrapper.close()
  assert.deepEqual(calls.slice(1), [['play'], ['pause'], ['close']])
})
