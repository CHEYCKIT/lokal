import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { mainArtistNames, isMainArtistRelease } = require('../electron/artistRoles.js')

test('excludes explicitly featured artists from the principal credit', () => {
  assert.deepEqual(mainArtistNames('King Gnu feat. Aimer'), ['King Gnu'])
  assert.deepEqual(mainArtistNames('King Gnu (featuring Aimer)'), ['King Gnu'])
  assert.deepEqual(mainArtistNames('Lead Artist [ft. Guest Artist]'), ['Lead Artist'])
})

test('keeps unlabelled collaborations as principal artists', () => {
  assert.deepEqual(mainArtistNames('King Gnu & Millennium Parade'), ['King Gnu', 'Millennium Parade'])
})

test('treats comma-delimited names after the first principal credit as supporting artists', () => {
  assert.deepEqual(mainArtistNames('King Gnu, Aimer, Guest Artist'), ['King Gnu'])
  assert.deepEqual(mainArtistNames('King Gnu & Millennium Parade, Aimer'), ['King Gnu', 'Millennium Parade'])
  assert.deepEqual(mainArtistNames('Tyler, the Creator, Kali Uchis'), ['Tyler, the Creator'])
})

test('classifies a guest release from its album-artist credit', () => {
  const release = { title: 'Ceremony', album_artist: 'King Gnu' }
  const tracks = [{ album: 'Ceremony', artist: 'King Gnu feat. Aimer', album_artist: 'King Gnu' }]
  assert.equal(isMainArtistRelease('Aimer', release, tracks), false)
  assert.equal(isMainArtistRelease('King Gnu', release, tracks), true)
})

test('falls back to principal track credits for Various Artists compilations', () => {
  const release = { title: 'Compilation', album_artist: 'Various Artists' }
  const tracks = [
    { album: 'Compilation', artist: 'Lead Artist feat. Guest Artist', album_artist: 'Various Artists' },
  ]
  assert.equal(isMainArtistRelease('Guest Artist', release, tracks), false)
  assert.equal(isMainArtistRelease('Lead Artist', release, tracks), true)
})
