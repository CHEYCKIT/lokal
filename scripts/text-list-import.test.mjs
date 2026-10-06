import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { parseTextList } = require('../electron/playlists/textList.js')

test('one song per line: "Artist - Title", or just a title', () => {
  assert.deepEqual(parseTextList('The Beatles - Hey Jude\nStairway to Heaven\n'), [
    { artist: 'The Beatles', title: 'Hey Jude' },
    { artist: null, title: 'Stairway to Heaven' },
  ])
})

test('the last " - " splits, so a dash in the artist stays with it', () => {
  assert.deepEqual(parseTextList('Jay-Z - Run This Town'), [{ artist: 'Jay-Z', title: 'Run This Town' }])
  assert.deepEqual(parseTextList('Crosby, Stills - Nash - Teach Your Children'), [{ artist: 'Crosby, Stills - Nash', title: 'Teach Your Children' }])
})

test('blank lines, numbering and bullets pasted along are dropped; Windows line ends too', () => {
  assert.deepEqual(parseTextList('1. Daft Punk - One More Time\r\n\r\n2) Kroi - SPIN\r\n- Forss - Flickermood\r\n• Soulhack'), [
    { artist: 'Daft Punk', title: 'One More Time' },
    { artist: 'Kroi', title: 'SPIN' },
    { artist: 'Forss', title: 'Flickermood' },
    { artist: null, title: 'Soulhack' },
  ])
})

test('nothing in, nothing out', () => {
  assert.deepEqual(parseTextList(''), [])
  assert.deepEqual(parseTextList(null), [])
  assert.deepEqual(parseTextList('   \n\n'), [])
})
