import test from 'node:test'
import assert from 'node:assert/strict'
import { canGetLossless } from '../src/quality.js'

const song = (extra = {}) => ({ id: 1, file_path: '/music/song.mp3', ...extra })

test('"Get it in lossless" is offered for lossy, suspect and not-yet-read library songs', () => {
  assert.equal(canGetLossless(song({ lossless: 0 })), true)
  assert.equal(canGetLossless(song({ lossless: 1, spectral_verdict: 'lossy' })), true)
  assert.equal(canGetLossless(song({ lossless: null })), true)
  assert.equal(canGetLossless(song()), true)
})

test('"Get it in lossless" is not offered for good lossless files, streams or missing files', () => {
  assert.equal(canGetLossless(song({ lossless: 1 })), false)
  assert.equal(canGetLossless(song({ lossless: 1, spectral_verdict: 'likely-lossy' })), false)
  assert.equal(canGetLossless(song({ file_path: 'ghost://yt/abc', lossless: 0 })), false)
  assert.equal(canGetLossless(song({ lossless: 0, missing: true })), false)
  assert.equal(canGetLossless({ title: 'online', lossless: 0 }), false)
  assert.equal(canGetLossless(null), false)
})
