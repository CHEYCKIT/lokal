import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { phoneFileName, reservePhoneDestination } = require('../server/phoneFileNaming')

test('preserves the original phone filename and audio extension', () => {
  assert.equal(phoneFileName({
    originalFilename: 'C:\\Music\\02 - Love Somebody.FLAC',
    artist: 'The Motion Epic',
    title: 'Love Somebody',
    extension: 'flac',
  }), '02 - Love Somebody.flac')
  assert.equal(phoneFileName({
    originalFilename: 'L’été — été.flac',
    artist: 'Artist',
    title: 'Title',
    extension: 'flac',
  }), 'L’été — été.flac')
})

test('old clients without a filename use readable tagged names', () => {
  assert.equal(phoneFileName({
    artist: 'The Motion Epic',
    title: 'Love Somebody',
    extension: 'flac',
  }), 'The Motion Epic - Love Somebody.flac')
  assert.equal(phoneFileName({
    originalFilename: '5855e467-d50b-45e1-a500-9c70289ab873.flac',
    artist: 'The Motion Epic',
    title: 'Love Somebody',
    extension: 'flac',
  }), 'The Motion Epic - Love Somebody.flac')
  assert.equal(phoneFileName({
    originalFilename: 'Misleading.mp3',
    artist: 'Artist',
    title: 'Actual Song',
    extension: 'flac',
  }), 'Artist - Actual Song.flac')
})

test('sanitizes path separators, Windows invalid characters and unsafe names', () => {
  assert.equal(phoneFileName({
    originalFilename: '../../maybe/CON.flac',
    artist: 'Artist',
    title: 'Title',
    extension: 'flac',
  }), '_CON.flac')
  assert.equal(phoneFileName({
    artist: 'Artist: Test',
    title: 'A/B? C< D>.',
    extension: 'flac',
  }), 'Artist Test - A B C D.flac')
  assert.equal(phoneFileName({
    originalFilename: '../normal.flac',
    extension: 'flac',
  }), 'normal.flac')
  assert.ok(phoneFileName({
    originalFilename: 'a'.repeat(400) + '.flac',
    extension: 'flac',
  }).length <= 165)
})

test('collisions preserve existing music and allocate readable suffixes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-phone-naming-'))
  try {
    const original = path.join(directory, 'Love Somebody.flac')
    const partial = path.join(directory, '.new.part')
    await fs.writeFile(original, 'first recording')
    await fs.writeFile(partial, 'second recording')
    const placed = await reservePhoneDestination(partial, directory, 'Love Somebody.flac')
    assert.equal(path.basename(placed), 'Love Somebody (2).flac')
    assert.equal(await fs.readFile(original, 'utf8'), 'first recording')
    assert.equal(await fs.readFile(placed, 'utf8'), 'second recording')
    // Staging cleanup cannot delete the final hard link.
    await fs.unlink(partial)
    assert.equal(await fs.readFile(placed, 'utf8'), 'second recording')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('simultaneous uploads with the same name never overwrite each other', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-phone-atomic-'))
  try {
    const partA = path.join(directory, '.a.part')
    const partB = path.join(directory, '.b.part')
    await fs.writeFile(partA, 'song A')
    await fs.writeFile(partB, 'song B')
    const destinations = await Promise.all([
      reservePhoneDestination(partA, directory, 'Shared.flac'),
      reservePhoneDestination(partB, directory, 'Shared.flac'),
    ])
    assert.notEqual(destinations[0], destinations[1])
    const bytes = await Promise.all(destinations.map(p => fs.readFile(p, 'utf8')))
    assert.deepEqual(new Set(bytes), new Set(['song A', 'song B']))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
