// Edit Track writes what it saves into the song's file (electron/fileComment.js
// writeFileTags, called by track:update and the web server's PUT /tracks/:id),
// so a rescan -- which reads the file with electron/musicMetadata.js, as here --
// gets the edited title, artist and the rest back, not the old ones.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { fileTagEdits, writeFileTags } = require('../electron/fileComment.js')
const mm = require('../electron/musicMetadata.js')

// About a second of silent MPEG-1 Layer III (128 kb/s, 44.1 kHz, stereo):
// every frame is a header and zeroed side info / main data, which decodes to
// silence. No tags at all, like a freshly ripped file.
function silentMp3(frames = 40) {
  const FRAME_BYTES = 417 // 144 * 128000 / 44100, no padding
  const frame = Buffer.alloc(FRAME_BYTES)
  frame.set([0xff, 0xfb, 0x90, 0x00])
  return Buffer.concat(Array.from({ length: frames }, () => frame))
}

function tempMp3(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-tags-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'song.mp3')
  fs.writeFileSync(file, silentMp3())
  return file
}

// What the library scan keeps of a file (see readTrackFile in electron/ipc/scanner.js).
async function scan(file) {
  const meta = await mm.parseFile(file, { duration: true, skipCovers: true })
  const c = meta.common
  return {
    title: c.title ?? null,
    artist: c.artist ?? null,
    album: c.album ?? null,
    album_artist: c.albumartist ?? null,
    track_num: c.track?.no ?? null,
    year: c.year ?? null,
    genres: c.genre ?? [],
    comment: (c.comment || []).map(entry => (typeof entry === 'string' ? entry : entry?.text)).filter(Boolean),
    label: c.label ?? [],
    tagTypes: meta.format.tagTypes,
    duration: meta.format.duration,
  }
}

test('the generated mp3 is a playable file without tags', async (t) => {
  const tags = await scan(tempMp3(t))
  assert.ok(tags.duration > 0.9 && tags.duration < 1.2, `duration ${tags.duration}`)
  assert.equal(tags.title, null)
  assert.deepEqual(tags.tagTypes, [])
})

test('Edit Track saves the title, artist and other tags into the file', async (t) => {
  const file = tempMp3(t)
  // What TrackEditModal sends for a song whose every field was changed
  // (plus fields that only live in the library, which the file must not get).
  const saved = {
    title: 'Новое название',
    artist: 'Protostar/Laminar (feat. Veronika Redd)',
    album: 'Night Drive',
    album_artist: 'Protostar',
    track_num: 7,
    year: 2024,
    genre: 'Synthwave',
    genres: 'Synthwave, Electronic',
    record_label: 'Monstercat',
    comment: 'first line\r\nsecond line',
    explicit: 1,
    clip_url: 'https://example.com/video',
    energy: 0.8,
  }
  const edits = fileTagEdits(saved)
  assert.deepEqual(Object.keys(edits).sort(), ['album', 'album_artist', 'artist', 'comment', 'genres', 'record_label', 'title', 'track_num', 'year'])
  writeFileTags(file, edits)

  const tags = await scan(file)
  assert.equal(tags.title, 'Новое название')
  assert.equal(tags.artist, 'Protostar/Laminar (feat. Veronika Redd)')
  assert.equal(tags.album, 'Night Drive')
  assert.equal(tags.album_artist, 'Protostar')
  assert.equal(tags.track_num, 7)
  assert.equal(tags.year, 2024)
  assert.deepEqual(tags.genres, ['Synthwave', 'Electronic'])
  assert.deepEqual(tags.label, ['Monstercat'])
  assert.deepEqual(tags.comment, ['first line\nsecond line'])
  assert.ok(tags.tagTypes.some(type => type.startsWith('ID3v2')), `tag types ${tags.tagTypes}`)
  // No ID3v1 tag added to a file that had none.
  assert.ok(!tags.tagTypes.includes('ID3v1'))
  assert.ok(tags.duration > 0.9, 'the audio is still there')
})

test('a second edit changes only what it sends, and an emptied field is removed', async (t) => {
  const file = tempMp3(t)
  writeFileTags(file, fileTagEdits({ title: 'Old title', artist: 'Old artist', album: 'Album', year: 1999, track_num: 3, comment: 'note' }))
  writeFileTags(file, fileTagEdits({ title: 'New title', album: null, year: null }))

  const tags = await scan(file)
  assert.equal(tags.title, 'New title')
  assert.equal(tags.artist, 'Old artist', 'a field the edit left out stays')
  assert.equal(tags.track_num, 3)
  assert.deepEqual(tags.comment, ['note'])
  assert.equal(tags.album, null, 'an emptied album is removed')
  assert.equal(tags.year, null, 'an emptied year is removed')
})

test('nothing to write leaves the file untouched', (t) => {
  const file = tempMp3(t)
  const before = fs.readFileSync(file)
  writeFileTags(file, fileTagEdits({ energy: 0.5, clip_url: 'x' }))
  assert.ok(before.equals(fs.readFileSync(file)))
})

test('a missing file is an error, not a silent no-op', () => {
  assert.throws(() => writeFileTags(path.join(os.tmpdir(), 'lokal-no-such-file.mp3'), { title: 'x' }), /File not found/)
})
