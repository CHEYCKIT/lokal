import test from 'node:test'
import assert from 'node:assert/strict'
import { makeBlobs, blobMask, blobBlur } from '../src/coverMix.js'

let seed = 3
const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }

test('the next cover grows in through blobs: none at first, all of it at the end', () => {
  const blobs = makeBlobs(14, random)
  assert.equal(blobs.length, 14)
  assert.ok(blobs.every(b => b.x >= 8 && b.x <= 92 && b.y >= 8 && b.y <= 92 && b.delay >= 0 && b.delay < 0.75))
  assert.equal(blobMask(blobs, 0).includes('radial-gradient'), blobs.some(b => b.delay === 0), 'nothing shows before the first blob starts')
  const middle = blobMask(blobs, 0.5)
  const shown = (middle.match(/radial-gradient/g) || []).length
  assert.ok(shown > 3 && shown <= 14, `${shown} blobs halfway`)
  assert.ok(!middle.includes('linear-gradient'), 'not filled in yet halfway')
  assert.match(blobMask(blobs, 1), /linear-gradient\(rgba\(0,0,0,1\.000\)/, 'all of it at the end')
})

test('blurred at first, sharp at the end', () => {
  assert.ok(blobBlur(0) > 10)
  assert.ok(blobBlur(0.5) > blobBlur(0.8))
  assert.equal(blobBlur(1), 0)
})
