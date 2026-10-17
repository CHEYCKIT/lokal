import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { dedupeMusicVideoItems } = require('../electron/online/musicVideo.js')

function item(trackId, videoId, overrides = {}) {
  const {
    saved = false,
    downloaded = false,
    file = null,
    check = 'title',
    motion = 'unverified',
    title = 'Song (Official Music Video)',
    artist = 'Artist',
  } = overrides
  return {
    track: { id: trackId, title: 'Song', artist, duration: 180 },
    video: { videoId, title, artist, check, motion, file },
    saved,
    downloaded,
  }
}

test('one YouTube video appears once when duplicate library tracks resolve to it', () => {
  const rows = [
    item('copy-flac', 'abcdefghijk'),
    item('copy-mp3', 'abcdefghijk', { check: 'audio', motion: 'verified', downloaded: true, file: '/cache/abcdefghijk.mp4' }),
    item('same-video-saved', 'abcdefghijk', { saved: true }),
    item('different-video', 'lmnopqrstuv'),
  ]

  const result = dedupeMusicVideoItems(rows)

  assert.equal(result.length, 2)
  const shared = result.find(row => row.video.videoId === 'abcdefghijk')
  assert.equal(shared.track.id, 'same-video-saved', 'prefer the saved track so save actions target the existing entry')
  assert.equal(shared.saved, true)
  assert.equal(shared.downloaded, true)
  assert.equal(shared.video.file, '/cache/abcdefghijk.mp4', 'keep a usable file from any duplicate')
  assert.equal(result.find(row => row.video.videoId === 'lmnopqrstuv').track.id, 'different-video')
})

test('different video IDs remain separate and malformed IDs do not merge unrelated tracks', () => {
  const rows = [
    item('one', 'abcdefghijk'),
    item('two', 'lmnopqrstuv'),
    item('bad-one', 'not-a-video-id'),
    item('bad-two', 'not-a-video-id'),
  ]

  const result = dedupeMusicVideoItems(rows)

  assert.equal(result.length, 4)
})

test('duplicate rows without saved entries keep the strongest validated match', () => {
  const rows = [
    item('weak-copy', 'abcdefghijk'),
    item('audio-checked-copy', 'abcdefghijk', { check: 'audio', motion: 'verified' }),
  ]

  const result = dedupeMusicVideoItems(rows)

  assert.equal(result.length, 1)
  assert.equal(result[0].track.id, 'audio-checked-copy')
})
