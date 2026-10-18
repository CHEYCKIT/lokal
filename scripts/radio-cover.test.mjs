import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { nowPlaying } = createRequire(import.meta.url)('../electron/radio/nowPlaying.js')

const reply = body => ({ status: 200, ok: true, headers: { get: () => null }, body: null, json: async () => body })
const api = { type: 'json', url: 'https://radio.test/latest', artist: '[0].artiste', title: '[0].titre' }

test('a station API without a cover gets the song\'s artwork', async () => {
  const fetchImpl = async url => reply(String(url).includes('itunes') ? { results: [{ trackName: 'Fly Away', artistName: 'NAO', artworkUrl100: 'https://img.test/a/100x100bb.jpg' }] } : [{ artiste: 'NAO', titre: 'Fly Away' }])
  assert.deepEqual(await nowPlaying(api, { fetchImpl }), { artist: 'NAO', title: 'Fly Away', cover: 'https://img.test/a/600x600bb.jpg' })
})

test('another song\'s artwork is never used, and the song still shows', async () => {
  const fetchImpl = async url => reply(String(url).includes('itunes') ? { results: [{ trackName: 'Something Else', artistName: 'Other', artworkUrl100: 'https://img.test/b/100x100bb.jpg' }] } : [{ artiste: 'Duo Nobody', titre: 'Unknown Song' }])
  assert.deepEqual(await nowPlaying(api, { fetchImpl }), { artist: 'Duo Nobody', title: 'Unknown Song' })
})

test('a cover the station gives is kept', async () => {
  const fetchImpl = async () => reply([{ artiste: 'A', titre: 'B', pic: 'https://own.test/c.jpg' }])
  assert.equal((await nowPlaying({ ...api, cover: '[0].pic' }, { fetchImpl })).cover, 'https://own.test/c.jpg')
})

test('one JSON for several stations: the entry named by match, with its cover and "m:ss" length', async () => {
  const list = [
    { radio: { code: 'nova-soul' }, currentTrack: { artist: 'A', title: 'Soul Song', image: 'https://img.test/s.jpg', duration: '03:24' } },
    { radio: { code: 'nova-danse' }, currentTrack: { artist: 'B', title: 'Dance Song', image: 'https://img.test/d.jpg', duration: '03:24' } },
  ]
  const nova = code => ({ type: 'json', url: 'https://radio.test/all.json', match: `radio.code=${code}`, artist: 'currentTrack.artist', title: 'currentTrack.title', cover: 'currentTrack.image', duration: 'currentTrack.duration' })
  const fetchImpl = async () => reply(list)
  assert.deepEqual(await nowPlaying(nova('nova-danse'), { fetchImpl }), { artist: 'B', title: 'Dance Song', cover: 'https://img.test/d.jpg', duration: 204 })
  assert.equal(await nowPlaying(nova('nova-missing'), { fetchImpl }), null)
})
