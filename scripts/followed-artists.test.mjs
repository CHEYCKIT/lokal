import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

async function followModule(settings) {
  globalThis.followTestApi = {
    getSettings: async () => ({ ...settings.current }),
    saveSettings: async values => { settings.current = { ...settings.current, ...values }; return { success: true } },
  }
  const source = (await readFile(new URL('../src/discoveryArtists.js', import.meta.url), 'utf8'))
    .replace("import { api } from './api'", 'const api = globalThis.followTestApi')
    .replace("from 'zustand'", `from '${pathToFileURL(require.resolve('zustand')).href}'`)
  return import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${Math.random()}`).toString('base64')}`)
}

test('the first run follows the library minus hidden artists, once', async () => {
  const settings = { current: { discovery_hidden_artists: JSON.stringify(['kroi']) } }
  const follows = await followModule(settings)
  await follows.initFollowedArtists([{ name: 'Daft Punk' }, { name: 'Kroi' }, { name: ' Westend ' }])
  assert.deepEqual(JSON.parse(settings.current.followed_artists), ['Daft Punk', 'Westend'])
  assert.equal(settings.current.followed_artists_ready, '1')
  // A new library artist later isn't followed by itself.
  await follows.initFollowedArtists([{ name: 'Daft Punk' }, { name: 'Kroi' }, { name: 'Westend' }, { name: 'Newcomer' }])
  assert.deepEqual(JSON.parse(settings.current.followed_artists), ['Daft Punk', 'Westend'])
})

test('follow and unfollow move an artist between the lists, in bulk too', async () => {
  const settings = { current: { followed_artists: JSON.stringify(['Daft Punk']), followed_artists_ready: '1' } }
  const follows = await followModule(settings)
  await follows.setArtistFollowed('Daft Punk', false)
  assert.deepEqual(JSON.parse(settings.current.followed_artists), [])
  assert.deepEqual(JSON.parse(settings.current.discovery_hidden_artists), ['daft punk'])
  await follows.setArtistsFollowed(['Daft Punk', 'Kroi', 'kroi'], true)
  assert.deepEqual(JSON.parse(settings.current.followed_artists), ['Daft Punk', 'Kroi'])
  assert.deepEqual(JSON.parse(settings.current.discovery_hidden_artists), [])
  const state = follows.useDiscoveryArtists.getState()
  assert.equal(follows.isArtistFollowed(state, ' KROI '), true)
  delete globalThis.followTestApi
})

test('Spotify: every page of the library\'s artists, the way the web player asks', async () => {
  const { followedArtists } = require('../electron/artwork/spotify.js')
  const artist = name => ({ item: { __typename: 'ArtistResponseWrapper', data: { __typename: 'Artist', profile: { name } } } })
  const asked = []
  const fetchPage = async url => {
    const parsed = new URL(url)
    const variables = JSON.parse(parsed.searchParams.get('variables'))
    asked.push([parsed.host, parsed.searchParams.get('operationName'), variables.filters, variables.offset])
    const all = [artist('Daft Punk'), { item: { __typename: 'PlaylistResponseWrapper', data: { __typename: 'Playlist', name: 'Not an artist' } } }, artist('Kroi')]
    return { data: { me: { libraryV3: { totalCount: all.length, items: all.slice(variables.offset, variables.offset + variables.limit) } } } }
  }
  assert.deepEqual(await followedArtists('sp_dc=abc;', { fetchPage, pageSize: 2 }), ['Daft Punk', 'Kroi'])
  assert.deepEqual(asked, [['api-partner.spotify.com', 'libraryV3', ['Artists'], 0], ['api-partner.spotify.com', 'libraryV3', ['Artists'], 2]])
  await assert.rejects(followedArtists('sp_dc=abc', { fetchPage: async () => ({ errors: [{ message: 'PersistedQueryNotFound' }] }) }), /PersistedQueryNotFound/)
  await assert.rejects(followedArtists('', { fetchPage }), /sp_dc/)
  // data and errors together, no library: an error, not "you follow nobody".
  await assert.rejects(followedArtists('sp_dc=abc', { fetchPage: async () => ({ data: { me: null }, errors: [{ message: 'Unauthorized' }] }) }), /Unauthorized/)
  await assert.rejects(followedArtists('sp_dc=abc', { fetchPage: async () => ({ data: { me: { libraryV3: null } } }) }), /library couldn't be read/)
  // An empty library is still an empty list.
  assert.deepEqual(await followedArtists('sp_dc=abc', { fetchPage: async () => ({ data: { me: { libraryV3: { totalCount: 0, items: [] } } } }) }), [])
})

test('Apple Music: the web player developer token, then every page of library artists', async () => {
  const apple = require('../electron/online/appleMusic.js')
  const jwt = payload => `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2ln`
  const web = jwt({ iss: 'AMPWebPlay', exp: Date.now() / 1000 + 3600 })
  const other = jwt({ iss: 'M62YD85FTQ', exp: Date.now() / 1000 + 3600 })
  assert.equal(apple.pickDeveloperToken(`a="${other}";b="${web}"`), web)
  assert.equal(apple.userTokenValue('media-user-token=XYZ; other=1'), 'XYZ')
  const asked = []
  const fetchImpl = async (url, { headers } = {}) => {
    asked.push([url, headers?.['media-user-token'] || null])
    const respond = body => ({ ok: true, status: 200, text: async () => body, json: async () => body })
    if (url.endsWith('/us/browse')) return respond('<script src="/assets/index~abc.js"></script>')
    if (url.endsWith('/assets/index~abc.js')) return respond(`x="${web}"`)
    if (url.includes('/v1/me/library/artists?limit=100')) return respond({ data: [{ attributes: { name: 'Daft Punk' } }], next: '/v1/me/library/artists?offset=100' })
    if (url.includes('offset=100')) return respond({ data: [{ attributes: { name: 'Kroi' } }] })
    return { ok: false, status: 404 }
  }
  assert.deepEqual(await apple.libraryArtists('XYZ', { fetchImpl }), ['Daft Punk', 'Kroi'])
  assert.deepEqual(asked.filter(([, token]) => token).map(([, token]) => token), ['XYZ', 'XYZ'])
  await assert.rejects(apple.libraryArtists('', { fetchImpl }), /media-user-token/)
})
