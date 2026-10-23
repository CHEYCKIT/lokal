import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bufferedMediaPercent } from '../src/streamBufferProgress.mjs'

const ranges = (...spans) => ({
  length: spans.length,
  start: i => spans[i][0],
  end: i => spans[i][1],
})

test('normal streams show 0% to 100% of buffered media time when track duration is known', () => {
  assert.equal(bufferedMediaPercent(ranges(), NaN, 180), 0)
  assert.equal(bufferedMediaPercent(ranges([0, 90]), NaN, 180), 50)
  assert.equal(bufferedMediaPercent(ranges([0, 180]), NaN, 180), 100)
})

test('prefer HTML audio metadata once it arrives', () => {
  assert.equal(bufferedMediaPercent(ranges([0, 45]), 90, 180), 50)
})

test('seeking and overlapping ranges never misreport entire track downloaded', () => {
  assert.equal(bufferedMediaPercent(ranges([110, 119]), NaN, 120), 7)
  assert.equal(bufferedMediaPercent(ranges([0, 40], [25, 50]), 100, null), 50)
  assert.equal(bufferedMediaPercent(ranges([0, 40], [10, 20], [50, 80]), 100, null), 70)
})

test('unknown media length stays indeterminate', () => {
  assert.equal(bufferedMediaPercent(ranges([0, 10]), Infinity, null), null)
  assert.equal(bufferedMediaPercent(undefined, NaN, 180), null)
  assert.equal(bufferedMediaPercent(ranges([0, 10]), 0, 0), null)
  assert.equal(bufferedMediaPercent(ranges([0, 1000]), 60), 100)
})
