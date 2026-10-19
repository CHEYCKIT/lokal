import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const mm = require('../electron/musicMetadata.js')
const { normalizeArtwork, writeEmbeddedArtwork } = require('../electron/fileArtwork.js')

// Tiny silent MPEG-1 Layer III file. It is sufficient to validate ID3 picture writes.
function silentMp3(frames = 40) {
  const frameBytes = 417
  const frame = Buffer.alloc(frameBytes)
  frame.set([0xff, 0xfb, 0x90, 0x00])
  return Buffer.concat(Array.from({ length: frames }, () => frame))
}

function tempMp3(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-artwork-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'song.mp3')
  fs.writeFileSync(file, silentMp3())
  return file
}

test('replacement artwork is embedded in the audio file as a front cover', async t => {
  const file = tempMp3(t)
  const source = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 20, g: 80, b: 180 } },
  }).png().toBuffer()
  const normalized = await normalizeArtwork(`data:image/png;base64,${source.toString('base64')}`)

  writeEmbeddedArtwork(file, normalized)

  const metadata = await mm.parseFile(file, { duration: true, skipCovers: false })
  const pictures = metadata.common.picture || []
  assert.equal(pictures.length, 1)
  assert.equal(pictures[0].format, 'image/jpeg')
  assert.ok(Buffer.from(pictures[0].data).equals(normalized), 'embedded picture bytes match the selected image after normalization')
})
