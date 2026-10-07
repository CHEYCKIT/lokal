import assert from 'node:assert/strict'
import { test } from 'node:test'

const store = new Map()
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }

const { buildRadio, emptyRadioMessage } = await import('../src/radioActions.js')

const song = i => ({ title: `Song ${i}`, artist: `Artist ${i}` })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// Playback sources that answer each song after a delay of its own.
function client({ radio = [], similar = null, delay = () => 5 } = {}) {
  return {
    getSettings: async () => ({ playback_search_order: JSON.stringify(['yt']) }),
    onlineProviders: async () => [{ id: 'yt' }],
    searchTracks: async () => [],
    onlineSearch: async query => {
      const i = Number(String(query).match(/Song (\d+)/)?.[1])
      await wait(delay(i))
      return { results: Number.isFinite(i) ? [{ ...song(i), id: `vid${String(i).padStart(8, '0')}`, provider: 'yt' }] : [] }
    },
    onlinePrepare: async () => ({ ok: true }),
    onlineSave: async items => items.map(item => ({ ...item, id: `yt-${item.id}`, file_path: `ghost://youtube/online/${item.id}` })),
    youtubeRadio: async () => radio,
    lastfmSimilar: async () => similar,
  }
}

test('the radio is announced song by song, the playable seed first', async () => {
  const seed = { ...song(0), id: 'seed', file_path: '/music/seed.flac', videoId: 'seedvideo01' }
  const seen = []
  const result = await buildRadio(seed, 'u', client({ radio: [song(1), song(2), song(3), song(4)] }), { onTracks: list => seen.push(list.map(t => t.title)) })
  assert.deepEqual(seen[0], ['Song 0'])
  assert.ok(seen.length >= 4, `announced ${seen.length} times`)
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].length >= seen[i - 1].length)
  assert.deepEqual(result.map(t => t.title).sort(), ['Song 0', 'Song 1', 'Song 2', 'Song 3', 'Song 4'])
})

test('a slow song does not hold back the ones after it', async () => {
  const seen = []
  const seed = { ...song(0), videoId: 'seedvideo01' }
  const promise = buildRadio(seed, 'u', client({ radio: [song(1), song(2), song(3)], delay: i => (i === 1 ? 300 : 5) }), { onTracks: list => seen.push(list.map(t => t.title)) })
  await wait(120)
  assert.ok(seen.at(-1)?.includes('Song 2') && !seen.at(-1).includes('Song 1'), JSON.stringify(seen))
  const result = await promise
  assert.equal(result.length, 3)
})

test('left (isCurrent false), it stops and announces nothing more', async () => {
  let current = true
  const seen = []
  const promise = buildRadio({ ...song(0), videoId: 'seedvideo01' }, 'u', client({ radio: [song(1), song(2), song(3), song(4), song(5), song(6)], delay: () => 40 }), { onTracks: list => seen.push(list.length), isCurrent: () => current })
  await wait(60)
  current = false
  const countAtLeave = seen.length
  assert.deepEqual(await promise, [])
  await wait(150)
  assert.equal(seen.length, countAtLeave)
})

test('artist radio announces each similar artist\'s songs as they come', async () => {
  const seen = []
  const c = client({ similar: { artists: [{ name: 'Artist 1' }, { name: 'Artist 2' }] } })
  c.onlineSearch = async name => ({ results: [{ title: `${name} hit`, artist: name, id: `${name.replace(/\W/g, '')}aaaaaaaa`.slice(0, 11), provider: 'yt' }] })
  const result = await buildRadio({ artist: 'Seed', type: 'artist' }, 'u', c, { onTracks: list => seen.push(list.length) })
  assert.equal(result.length, 2)
  assert.deepEqual(seen, [1, 2])
})

test('an empty radio says why', () => {
  assert.match(emptyRadioMessage({ artist: 'Seed', type: 'artist' }), /Last\.fm/)
  assert.match(emptyRadioMessage({ artist: 'Seed', title: 'Song' }), /playback sources/)
})

test('the queue: extended only while it is that radio playing; a radio from the playing song keeps it going', async () => {
  const { usePlayerStore } = await import('../src/store/player.js')
  const t = i => ({ id: `t${i}`, title: `Song ${i}`, artist: 'A', file_path: `/m/${i}.flac` })
  const radio = { type: 'radio', name: 'R', id: 'radio-1' }
  usePlayerStore.getState().playQueue([t(1), t(2)], 0, radio)
  usePlayerStore.getState().extendQueue([t(1), t(2), t(3), t(4)], radio)
  assert.deepEqual(usePlayerStore.getState().queue.map(x => x.id), ['t1', 't2', 't3', 't4'])
  usePlayerStore.getState().extendQueue([t(5)], { ...radio, id: 'radio-2' })
  assert.equal(usePlayerStore.getState().queue.length, 4, 'another radio leaves this queue alone')

  usePlayerStore.getState().playQueue([t(9)], 0, null)
  const generation = usePlayerStore.getState().playbackGeneration
  assert.equal(usePlayerStore.getState().continueAsQueue([t(9), t(10)], radio), true)
  const state = usePlayerStore.getState()
  assert.deepEqual(state.queue.map(x => x.id), ['t9', 't10'])
  assert.equal(state.currentTrack.id, 't9')
  assert.equal(state.playbackGeneration, generation, 'the playing song is not restarted')
  assert.equal(usePlayerStore.getState().continueAsQueue([t(10)], radio), false)
})
