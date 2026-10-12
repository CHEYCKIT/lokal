import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { decode } = require('../electron/automix/index.js')

// A stand-in for ffmpeg: writes some audio, then exits with `code`.
function fakeFfmpeg(t, code) {
  const dir = mkdtempSync(join(tmpdir(), 'lokal-ffmpeg-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'ffmpeg')
  writeFileSync(file, `#!/usr/bin/env node\nprocess.stdout.write(Buffer.alloc(4096))\nprocess.stderr.write('Connection reset by peer\\n')\nprocess.exitCode = ${code}\n`)
  chmodSync(file, 0o755)
  return file
}

test('ffmpeg failing part way: no analysis of half a song', { skip: process.platform === 'win32' }, async t => {
  await assert.rejects(decode(fakeFfmpeg(t, 1), 'song.flac'), /Connection reset/)
})

test('ffmpeg finishing: its audio', { skip: process.platform === 'win32' }, async t => {
  const pcm = await decode(fakeFfmpeg(t, 0), 'song.flac')
  assert.equal(pcm.length, 4096)
})
