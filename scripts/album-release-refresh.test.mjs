import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCachedReleaseTypes } from '../src/albumReleaseTypes.js'
import { startReleaseRefresh, useReleaseRefresh } from '../src/store/releaseRefresh.js'

test('manual refresh is single-flight, survives route subscribers leaving, and preserves classifications on misses', async () => {
  const values = new Map()
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const albums = [{ title: 'Full Album', album_artist: 'Artist', track_count: 1, release_type: 'single' }]
  let release
  let calls = 0
  const client = { discoveryCatalogue: async () => {
    calls++
    await new Promise(resolve => { release = resolve })
    return { albums: [{ title: 'Full Album', artist: 'Artist', release_type: 'album' }] }
  } }
  const unsubscribe = useReleaseRefresh.subscribe(() => {})
  const first = startReleaseRefresh(albums, client)
  assert.equal(startReleaseRefresh(albums, client), first)
  await new Promise(resolve => setImmediate(resolve))
  unsubscribe()
  assert.equal(useReleaseRefresh.getState().running, true)
  release()
  await first
  assert.equal(calls, 1)
  assert.equal(useReleaseRefresh.getState().done, 1)
  assert.equal(useReleaseRefresh.getState().running, false)
  assert.equal(applyCachedReleaseTypes(albums)[0].release_type, 'album')
  await startReleaseRefresh(albums, { discoveryCatalogue: async () => ({ albums: [], tracks: [] }), getSettings: async () => ({}) })
  assert.equal(useReleaseRefresh.getState().failed, 1)
  assert.equal(applyCachedReleaseTypes(albums)[0].release_type, 'album')
})
