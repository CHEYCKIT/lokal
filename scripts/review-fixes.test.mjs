import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as clipVideo from '../src/clipVideo.js'
import * as renderer from '../src/artistNames.js'

const require = createRequire(import.meta.url)
const { isPublicHttpUrl } = require('../electron/online/publicUrl.js')
const main = require('../electron/artistSplit.js')

test('clip URL parsing accepts POSIX paths as well as Windows paths', () => {
  assert.equal(clipVideo.clipVideoLink('/tmp/visualization.mp4'), '/tmp/visualization.mp4')
  assert.equal(clipVideo.clipOpenUrl('/tmp/visualization.mp4'), 'file:///tmp/visualization.mp4')
  assert.equal(clipVideo.clipVideoLink('C:\\Music\\visualization.mp4'), 'C:\\Music\\visualization.mp4')
  assert.equal(clipVideo.clipVideoLink('https://example.com/clip.mp4'), 'https://example.com/clip.mp4')
})

test('clip time parsing rejects negative values before stripping punctuation', () => {
  assert.ok(Number.isNaN(clipVideo.parseClipTime('-1')))
  assert.ok(Number.isNaN(clipVideo.parseClipTime('1:-2')))
  assert.equal(clipVideo.parseClipTime('1:02'), 62)
})

test('clip ranges remain bounded by the video duration', () => {
  assert.deepEqual(clipVideo.clipRange(150, 180, 120), { start: 110, end: 120 })
  assert.deepEqual(clipVideo.clipRange(120, null, 120), { start: 110, end: 120 })
  assert.deepEqual(clipVideo.clipRange(5, 15, 120), { start: 5, end: 15 })
})

test('server-side remote URL guard blocks private and non-HTTP targets', async () => {
  for (const url of [
    'http://127.0.0.1/admin',
    'http://10.0.0.8/',
    'http://192.168.1.10/',
    'http://[::1]/',
    'http://localhost/',
    'http://printer.local/',
    'file:///etc/passwd',
  ]) {
    assert.equal(await isPublicHttpUrl(url, { resolveDns: false }), false, url)
  }
  assert.equal(await isPublicHttpUrl('https://example.com/catalog.json', { resolveDns: false }), true)
})

test('bare remix/production/instrumental roles split in both artist-credit parsers', () => {
  const cases = [
    ['A remix B', ['A', 'B']],
    ['A remixed by B', ['A', 'B']],
    ['A prod. by B', ['A', 'B']],
    ['A instr. B', ['A', 'B']],
  ]
  for (const [credit, expected] of cases) {
    assert.deepEqual(main.splitArtists(credit), expected, credit)
    assert.deepEqual(renderer.splitArtists(credit), expected, credit)
  }
})
