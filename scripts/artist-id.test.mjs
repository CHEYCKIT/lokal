import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { artistIdFromName as clientId, sha256Hex } from '../src/artistId.js'
import { artistToSlug } from '../src/artistLink.js'

const require = createRequire(import.meta.url)
const { artistIdFromName: serverId, findArtistById } = require('../electron/artistId.js')
const crypto = require('crypto')

const NAMES = ['Daft Punk', 'Beyoncé', 'BEYONCÉ', '宇多田ヒカル', 'YOASOBI', 'ヨルシカ', '米津玄師', 'Ado', 'Sigur Rós', 'Мумий Тролль', 'हनी सिंह', '!!!', '†', '♡', '  ', '', 'AC/DC', 'Tyler, The Creator', 'ＡＢＣ']

test('client and main process give every name the same id', () => {
  for (const name of NAMES) assert.equal(clientId(name), serverId(name), name)
})

test('the client sha256 matches node', () => {
  for (const text of ['', 'abc', '!!!', 'x'.repeat(200), '宇多田']) {
    assert.equal(sha256Hex(text), crypto.createHash('sha256').update(text, 'utf8').digest('hex'))
  }
})

test('non-Latin names get distinct, readable ids', () => {
  assert.equal(serverId('宇多田ヒカル'), 'a-宇多田ヒカル')
  assert.notEqual(serverId('ヨルシカ'), serverId('米津玄師'))
  assert.equal(serverId('Daft Punk'), 'a-daft-punk')
  assert.match(serverId('!!!'), /^a-[0-9a-f]{12}$/)
  assert.notEqual(serverId('!!!'), serverId('†'))
  assert.equal(serverId(''), 'a-unknown')
})

test('artistToSlug links to the same id the scanner makes', () => {
  assert.equal(`a-${artistToSlug('ヨルシカ')}`, serverId('ヨルシカ'))
  assert.equal(`a-${artistToSlug('!!!')}`, serverId('!!!'))
  assert.equal(`a-${artistToSlug('Tyler, The Creator', ['Tyler, The Creator'])}`, serverId('Tyler, The Creator'))
})

function fakeDb(rows) {
  return {
    prepare(sql) {
      return {
        get: (value) => sql.includes('LOWER(name)') ? rows.find(r => r.name.toLowerCase() === String(value).toLowerCase()) : rows.find(r => r.id === value),
        iterate: () => rows[Symbol.iterator](),
      }
    },
  }
}

test('findArtistById resolves hash ids and old-style ids without guessing a name from a hash', () => {
  const db = fakeDb([{ id: 'a-unknown', name: '宇多田ヒカル' }, { id: 'a-x1', name: '!!!' }, { id: 'a-beyonc', name: 'Beyoncé' }, { id: 'a-a1b2c3d4e5f6', name: 'a1b2c3d4e5f6x' }])
  assert.equal(findArtistById(db, 'a-宇多田ヒカル').id, 'a-unknown')
  assert.equal(findArtistById(db, serverId('!!!')).id, 'a-x1')
  assert.equal(findArtistById(db, 'a-beyoncé').id, 'a-beyonc')
  assert.equal(findArtistById(db, 'a-0123456789ab'), null)
})
