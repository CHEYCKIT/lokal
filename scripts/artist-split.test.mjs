import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as renderer from '../src/artistNames.js'

const require = createRequire(import.meta.url)
const main = require('../electron/artistSplit.js')

const CASES = [
  ['Ark Patrol (feat. Veronika Redd)', ['Ark Patrol', 'Veronika Redd']],
  ['Ark Patrol feat Veronika Redd', ['Ark Patrol', 'Veronika Redd']],
  ['Ark Patrol ft. Veronika Redd', ['Ark Patrol', 'Veronika Redd']],
  ['Kavinsky & Lovefoxxx [feat. Ark Patrol, Veronika Redd]', ['Kavinsky', 'Lovefoxxx', 'Ark Patrol', 'Veronika Redd']],
  ['GRXVITON/Foyon/Rumusen', ['GRXVITON', 'Foyon', 'Rumusen']],
  ['GRXVITON \\ Foyon', ['GRXVITON', 'Foyon']],
  ['GRXVITON; Foyon;Rumusen', ['GRXVITON', 'Foyon', 'Rumusen']],
  ['GRXVITON,Foyon, Rumusen', ['GRXVITON', 'Foyon', 'Rumusen']],
  ['Баста, Скриптонит', ['Баста', 'Скриптонит']],
  ['Tyler, The Creator (feat. Kali Uchis)', ['Tyler, The Creator', 'Kali Uchis']],
  ['Tyler, The Creator/Foyon', ['Tyler, The Creator', 'Foyon']],
  ['AC/DC', ['AC/DC']],
  ['Akira Flay, oneohkay (Jimorrow Remix)', ['Akira Flay', 'oneohkay', 'Jimorrow']],
  ['Tyler, the Creator & Foyon', ['Tyler, the Creator', 'Foyon']],
  ['Earth, Wind & Fire', ['Earth, Wind & Fire']],
  ['10,000 Maniacs', ['10,000 Maniacs']],
  ['h x m x d', ['h x m x d']],
  ['Daft Punk', ['Daft Punk']],
  ['The Weeknd (Martin Garrix Remix)', ['The Weeknd', 'Martin Garrix']],
  ['The Weeknd (Remix Martin Garrix)', ['The Weeknd', 'Martin Garrix']],
  ['The Weeknd (martin garrix REMIX)', ['The Weeknd', 'martin garrix']],
  ['The Weeknd (Martin Garrix prod)', ['The Weeknd', 'Martin Garrix']],
  ['The Weeknd (PROD Martin Garrix)', ['The Weeknd', 'Martin Garrix']],
  ['The Weeknd (prod. by Martin Garrix)', ['The Weeknd', 'Martin Garrix']],
  ['The Weeknd (instr. Martin Garrix)', ['The Weeknd', 'Martin Garrix']],
  ['The Weeknd (INSTR by Martin Garrix)', ['The Weeknd', 'Martin Garrix']],
  ['The Weeknd [Martin Garrix instr.]', ['The Weeknd', 'Martin Garrix']],
  ['The Weeknd (Instrumental)', ['The Weeknd']],
  ['The Weeknd (Radio Remix)', ['The Weeknd']],
  ['Sigur Rós (Live)', ['Sigur Rós']],
  ['Conquer Divide, DVRK (Remix)', ['Conquer Divide', 'DVRK']],
  ['Conquer Divide (COVER)', ['Conquer Divide']],
  ['DVRK (dubstep remix)', ['DVRK']],
  ['DVRK [DUBSTEP REMIX]', ['DVRK']],
  ['DVRK (Slowed + Reverb)', ['DVRK']],
  ['DVRK (2019 Remaster)', ['DVRK']],
  ['DVRK (Phonk Remix) feat. Foyon', ['DVRK', 'Foyon']],
  ['Protostar/Laminar/imallryt', ['Protostar', 'Laminar', 'imallryt']],
  ['AC/DC/Foyon', ['AC/DC', 'Foyon']],
  ['Foyon & Simon & Garfunkel', ['Foyon', 'Simon & Garfunkel']],
]

test("a name from the keep list stays whole whatever separator it holds", () => {
  const keep = main.keepCommaSet(['Mumford & Sons', 'Above/Beyond'])
  assert.deepEqual(main.splitArtists('Mumford & Sons/Protostar', keep), ['Mumford & Sons', 'Protostar'])
  assert.deepEqual(main.splitArtists('Protostar & Above/Beyond (feat. Mumford & Sons)', keep), ['Protostar', 'Above/Beyond', 'Mumford & Sons'])
  assert.deepEqual(main.splitArtists('Mumford & Sonsy', keep), ['Mumford', 'Sonsy'])
  const rendererKeep = renderer.keepCommaSet(['Mumford & Sons', 'Above/Beyond'])
  assert.deepEqual(renderer.splitArtists('Protostar & Above/Beyond (feat. Mumford & Sons)', rendererKeep), ['Protostar', 'Above/Beyond', 'Mumford & Sons'])
})

test('artist credits split into every credited artist', () => {
  for (const [credit, expected] of CASES) assert.deepEqual(main.splitArtists(credit), expected, credit)
})

test('a credit keeps its own text, with every artist marked', () => {
  const shown = credit => renderer.artistCreditParts(credit).map(part => part.artist ? `[${part.text}]` : part.text).join('')
  assert.equal(shown('Ark Patrol (feat. Veronika Redd)'), '[Ark Patrol] (feat. [Veronika Redd])')
  assert.equal(shown('Ark Patrol feat. Veronika Redd'), '[Ark Patrol] feat. [Veronika Redd]')
  assert.equal(shown('Kavinsky & Lovefoxxx [ft. Ark Patrol/Veronika Redd]'), '[Kavinsky] & [Lovefoxxx] [ft. [Ark Patrol], [Veronika Redd]]')
  assert.equal(shown('GRXVITON/Foyon \\ Rumusen;Hope'), '[GRXVITON], [Foyon], [Rumusen], [Hope]')
  assert.equal(shown('AC/DC'), '[AC/DC]')
  assert.equal(shown('The Weeknd (Martin Garrix Remix)'), '[The Weeknd] ([Martin Garrix] Remix)')
  assert.equal(shown('The Weeknd (prod Martin Garrix)'), '[The Weeknd] (prod [Martin Garrix])')
  assert.equal(shown('Tyler, The Creator (feat. Kali Uchis)'), '[Tyler, The Creator] (feat. [Kali Uchis])')
})

test("the renderer's copy splits the same way", () => {
  const keep = ['GRXVITON/Foyon']
  for (const [credit] of [...CASES, ['GRXVITON/Foyon/Rumusen']]) {
    assert.deepEqual(renderer.splitArtists(credit), main.splitArtists(credit), credit)
    assert.deepEqual(renderer.splitArtists(credit, renderer.keepCommaSet(keep)), main.splitArtists(credit, main.keepCommaSet(keep)), credit)
  }
})

test("the user's separator words split credits like feat., in both copies", (t) => {
  t.after(() => { main.setSplitWords([]); renderer.setSplitWords([]) })
  assert.deepEqual(main.normalizeSplitWords(['With', ' mixed  by ', 'with', 'feat.', 'PROD', '', null]), ['with', 'mixed by'])
  for (const side of [main, renderer]) {
    side.setSplitWords(['with', 'Mixed By.', 'x.'])
    assert.deepEqual(side.splitArtists('Protostar with Laminar'), ['Protostar', 'Laminar'])
    assert.deepEqual(side.splitArtists('Protostar (mixed by Laminar)'), ['Protostar', 'Laminar'])
    assert.deepEqual(side.splitArtists('Protostar [Laminar mixed by]'), ['Protostar', 'Laminar'])
    assert.deepEqual(side.splitArtists('Protostar (with Laminar) feat. Foyon'), ['Protostar', 'Foyon', 'Laminar'])
    // Only as a whole word.
    assert.deepEqual(side.splitArtists('Without Words'), ['Without Words'])
    assert.deepEqual(side.splitArtists('The Weeknd (Radio Remix)'), ['The Weeknd'])
    side.setSplitWords([])
    assert.deepEqual(side.splitArtists('Protostar with Laminar'), ['Protostar with Laminar'])
  }
  assert.ok(main.DEFAULT_SPLIT_WORDS.includes('feat.') && main.DEFAULT_SPLIT_WORDS.includes('instr.'))
  assert.deepEqual(main.DEFAULT_SPLIT_WORDS, renderer.DEFAULT_SPLIT_WORDS)
})
