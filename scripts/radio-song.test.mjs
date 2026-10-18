import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { resolveStationSong } = await import('../src/radio/stationSong.js')

const station = (over = {}) => ({ song_key: 'nova:a:b', artist: 'Artist', title: 'Title', ...over })

test('the playing radio song is looked up online once, by artist and title', async () => {
  const asked = []
  const resolve = async rows => { asked.push(rows); return [{ id: 'yt:1', title: 'Title', artist: 'Artist' }] }
  const first = await resolveStationSong(station(), {}, resolve)
  const again = await resolveStationSong(station(), {}, resolve)
  assert.equal(first.id, 'yt:1')
  assert.equal(again.id, 'yt:1')
  assert.deepEqual(asked, [[{ title: 'Title', artist: 'Artist' }]], 'asked once')
})

test('a song that can not be found is asked for again next time', async () => {
  let calls = 0
  const resolve = async () => { calls++; return [] }
  assert.equal(await resolveStationSong(station({ song_key: 'nova:x:y' }), {}, resolve), null)
  await new Promise(r => setTimeout(r, 5))
  await resolveStationSong(station({ song_key: 'nova:x:y' }), {}, resolve)
  assert.equal(calls, 2)
})

test('a station with no named song resolves to nothing', async () => {
  assert.equal(await resolveStationSong({ title: 'Station' }, {}, async () => [{ id: 'x' }]), null)
})
