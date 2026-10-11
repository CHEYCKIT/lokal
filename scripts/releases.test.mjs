import test from 'node:test'
import assert from 'node:assert/strict'
import { checkReleases, isNewRelease, latestReleases, savedReleases } from '../src/newReleases.js'

const memory = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) } }

test('latest releases: newest first, no year cut-off, nothing from the future, at most the limit', () => {
  const now = new Date('2026-10-11T00:00:00Z')
  const items = latestReleases([
    { title: 'Old', artist: 'A', year: 2009 },
    { title: 'Future', artist: 'A', year: 2027 },
    { title: 'Soon', artist: 'B', release_date: '2026-12-01' },
    { title: 'Recent', artist: 'B', release_date: '2026-09-30' },
    { title: 'Second', artist: 'C', year: 2026, rank: 1 },
    { title: 'First', artist: 'C', year: 2026, rank: 0 },
    { title: 'first', artist: 'c', year: 2026, rank: 5 },
  ], { now, limit: 4 })
  assert.deepEqual(items.map(item => item.title), ['Recent', 'First', 'Second', 'Old'])
})

test('a check covers every artist and saves the result', async () => {
  const storage = memory()
  const catalogue = { One: [{ title: 'Alpha', year: 2025 }], Two: [{ title: 'Beta', year: 2024 }] }
  const artists = Object.keys(catalogue).map(name => ({ name }))
  const first = await checkReleases(artists, async name => catalogue[name], { storage, now: new Date('2026-01-01') })
  assert.equal(first.artists, 2)
  assert.deepEqual(first.items.map(item => item.title), ['Alpha', 'Beta'])
  catalogue.Two.unshift({ title: 'Gamma', year: 2026 })
  const second = await checkReleases(artists, async name => catalogue[name], { storage, now: new Date('2026-06-01') })
  assert.deepEqual(second.items.map(item => item.title), ['Gamma', 'Alpha', 'Beta'])
  assert.equal(savedReleases(storage).items.length, 3)
})

test('failed artists keep their releases from the last check; nothing checked keeps it all', async () => {
  const storage = memory()
  const artists = [{ name: 'One' }, { name: 'Two' }]
  const empty = await checkReleases(artists, async () => [], { storage, now: new Date('2026-01-01') })
  assert.equal(empty.items.length, 0)
  await checkReleases(artists, async name => name === 'One' ? [{ title: 'Alpha', year: 2026 }] : [{ title: 'Beta', year: 2025 }], { storage, now: new Date('2026-02-01') })
  const partial = await checkReleases(artists, async name => { if (name === 'Two') throw new Error('Offline'); return [{ title: 'Alpha', year: 2026 }] }, { storage, now: new Date('2026-03-01') })
  assert.deepEqual(partial.items.map(item => item.title), ['Alpha', 'Beta'])
  const offline = await checkReleases(artists, async () => { throw new Error('Offline') }, { storage, now: new Date('2026-04-01') })
  assert.equal(offline.failures, 2)
  assert.deepEqual(savedReleases(storage).items.map(item => item.title), ['Alpha', 'Beta'])
})

test('a release is new for the week after its release date only', () => {
  const now = new Date('2026-10-11T12:00:00Z')
  const on = release_date => isNewRelease({ title: 'X', artist: 'A', release_date }, now)
  assert.equal(on('2026-10-11'), true) // today
  assert.equal(on('2026-10-05'), true) // 6 days ago
  assert.equal(on('2026-10-04'), false) // 7½ days ago
  assert.equal(on('2026-09-01'), false)
  assert.equal(on('2026-10-12'), false) // not out yet
  assert.equal(isNewRelease({ title: 'X', artist: 'A', year: 2026 }, now), false) // only a year: can't tell
  assert.equal(isNewRelease({ title: 'X', artist: 'A', releaseDate: '2026-10-09' }, now.getTime()), true)
  // A stored flag from an older check doesn't count.
  assert.equal(isNewRelease({ title: 'X', artist: 'A', year: 2019, isNew: true }, now), false)
})

test('releases sort newest first by their exact date', () => {
  const items = latestReleases([
    { title: 'March', artist: 'A', release_date: '2026-03-02' },
    { title: 'September', artist: 'B', release_date: '2026-09-30' },
    { title: 'Last year', artist: 'C', release_date: '2025-12-31' },
    { title: 'June', artist: 'D', release_date: '2026-06-15' },
  ], { now: new Date('2026-10-11') })
  assert.deepEqual(items.map(item => item.title), ['September', 'June', 'March', 'Last year'])
})

test('Deezer gives releases their exact dates; an unknown artist falls back', async () => {
  const { createRequire } = await import('node:module')
  const { deezerReleases, releaseCatalogue } = createRequire(import.meta.url)('../electron/online/releaseDates.js')
  const fetchImpl = async url => ({ ok: true, json: async () => url.includes('/search/artist')
    ? { data: [{ id: 2, name: 'Nova Lights', nb_fan: 5 }, { id: 1, name: 'Nova Lights', nb_fan: 900 }, { id: 3, name: 'Nova Lights Tribute' }] }
    : { data: [{ title: 'Satellite', release_date: '2026-09-30', record_type: 'single', cover_xl: 'https://cdn/x.jpg' }, { title: 'Undated' }] } })
  const result = await deezerReleases('Nova Lights', fetchImpl)
  assert.deepEqual(result.albums, [{ title: 'Satellite', artist: 'Nova Lights', release_date: '2026-09-30', year: 2026, release_type: 'single', artwork_url: 'https://cdn/x.jpg', source: 'deezer' }])
  const fallback = await releaseCatalogue({ artist: 'Nobody' }, async () => ({ albums: ['yt'] }), async () => ({ ok: true, json: async () => ({ data: [] }) }))
  assert.deepEqual(fallback, { albums: ['yt'] })
})

test('a check adds to the last one instead of starting over', async () => {
  const storage = memory()
  const artists = [{ name: 'One' }, { name: 'Two' }]
  const catalogue = { One: [{ title: 'Alpha', release_date: '2026-09-01' }], Two: [{ title: 'Beta', release_date: '2026-08-01' }] }
  const first = await checkReleases(artists, async name => catalogue[name], { storage, now: new Date('2026-10-01') })
  assert.equal(first.added, 2)
  catalogue.One.unshift({ title: 'Gamma', release_date: '2026-10-09' })
  const progress = []
  const second = await checkReleases(artists, async name => catalogue[name], {
    storage, now: new Date('2026-10-11'), concurrency: 1,
    onProgress: ({ done, items, added }) => progress.push([done, items.map(item => item.title), added]),
  })
  // The last check's releases show from the start; the new one joins them.
  assert.deepEqual(progress, [[1, ['Gamma', 'Alpha', 'Beta'], 1], [2, ['Gamma', 'Alpha', 'Beta'], 1]])
  assert.deepEqual(second.items.map(item => item.title), ['Gamma', 'Alpha', 'Beta'])
  assert.equal(second.added, 1)
  // An artist gone from the library takes its releases along.
  const third = await checkReleases([{ name: 'One' }], async name => catalogue[name], { storage, now: new Date('2026-10-12') })
  assert.deepEqual(third.items.map(item => item.title), ['Gamma', 'Alpha'])
  assert.equal(third.added, 0)
})

test('a release found again is updated in place, not added twice', async () => {
  const storage = memory()
  await checkReleases([{ name: 'One' }], async () => [{ title: 'Alpha', release_date: '2026-09-01', artwork: 'old.jpg' }], { storage, now: new Date('2026-10-01') })
  const again = await checkReleases([{ name: 'One' }], async () => [{ title: 'Alpha', release_date: '2026-09-01', artwork: 'new.jpg' }], { storage, now: new Date('2026-10-02') })
  assert.equal(again.items.length, 1)
  assert.equal(again.items[0].artwork, 'new.jpg')
  assert.equal(again.added, 0)
})
