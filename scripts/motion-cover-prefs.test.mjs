import assert from 'node:assert/strict'
import { test } from 'node:test'

const store = new Map()
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) }
const events = []
globalThis.window = { dispatchEvent: e => events.push(e), addEventListener() {}, removeEventListener() {} }
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail } }

const { isMotionCoverOff, setMotionCoverOff } = await import('../src/motionCoverPrefs.js')

test("a song's moving cover is turned off and on by artist and title, streamed or a file", () => {
  const streamed = { id: 'yt-abc', title: 'September', artist: 'Earth, Wind & Fire' }
  const file = { id: 't-123', title: 'september', artist: 'Earth Wind & Fire' }
  assert.equal(isMotionCoverOff(streamed), false)
  setMotionCoverOff(streamed, true)
  assert.equal(isMotionCoverOff(file), true)
  assert.equal(isMotionCoverOff({ title: 'Fantasy', artist: 'Earth, Wind & Fire' }), false)
  assert.equal(events.at(-1).type, 'lokal:motion-cover-pref')
  setMotionCoverOff(file, false)
  assert.equal(isMotionCoverOff(streamed), false)
  assert.equal(isMotionCoverOff(null), false)
})
