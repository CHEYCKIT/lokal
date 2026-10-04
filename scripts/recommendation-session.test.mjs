import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRecommendationSession } from '../src/recommendationSession.js'

const candidates = Array.from({ length: 40 }, (_, i) => ({ id: `local-${i}`, title: `Song ${i}`, artist: 'Artist', file_path: `/music/${i}.flac` }))
function mock() {
  const pages = []
  let settings = { lastfm_username: 'listener', lastfm_enabled: '1' }
  const client = {
    getSettings: async () => settings,
    lastfmDiscovery: async (page, force) => { pages.push({ page, force }); return { candidates, quickPicks: candidates.slice(0, 12), history: [], artists: [], albums: [], freshFinds: candidates.slice(0, 30) } },
    onlineProviders: async () => [{ id: 'yt' }],
  }
  return { client, pages, setSettings: next => { settings = next } }
}

test('navigation and subscriber remounts retain Discovery, Mix, selected tab, and pagination', async () => {
  const { client, pages } = mock()
  const session = createRecommendationSession(client)
  const unsubscribe = session.subscribe(() => {})
  await session.ensure()
  await session.generate(24)
  const data = session.getSnapshot().data
  const mix = session.getSnapshot().mix
  session.setTab('mixlab')
  unsubscribe()
  await session.ensure()
  await session.ensure()
  assert.equal(session.getSnapshot().data, data)
  assert.equal(session.getSnapshot().mix, mix)
  assert.equal(session.getSnapshot().tab, 'mixlab')
  assert.deepEqual(pages.map(item => item.page), [0, 1])
  await session.refresh()
  assert.deepEqual(pages.at(-1), { page: 1, force: true })
  assert.equal(session.getSnapshot().mix, mix, 'Discovery refresh does not regenerate Mix')
})

test('pending provider responses survive navigation; failed sessions retry only on refresh', async () => {
  const { client, pages } = mock()
  let release
  client.lastfmDiscovery = () => new Promise(resolve => { release = resolve })
  const session = createRecommendationSession(client)
  const unsubscribe = session.subscribe(() => {})
  const loading = session.ensure()
  await new Promise(resolve => setImmediate(resolve))
  unsubscribe()
  release({ error: 'Temporary provider outage' })
  await loading
  client.lastfmDiscovery = async page => { pages.push(page); return { candidates, freshFinds: candidates } }
  await session.ensure()
  assert.equal(pages.length, 0)
  assert.match(session.getSnapshot().error, /outage/)
  await session.refresh()
  assert.equal(pages.length, 1)
  assert.equal(session.getSnapshot().data.freshFinds.length, 40)
})

test('invalidating an in-flight Mix clears the generating state even when settings fail to reload', async () => {
  const { client } = mock()
  const session = createRecommendationSession(client)
  await session.ensure()
  let release
  client.lastfmDiscovery = () => new Promise(resolve => { release = resolve })
  const generating = session.generate(24)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(session.getSnapshot().generating, true)
  client.getSettings = async () => { throw new Error('Settings unavailable') }
  await session.invalidate()
  assert.equal(session.getSnapshot().generating, false)
  release({ candidates })
  await generating
  assert.equal(session.getSnapshot().generating, false)
  assert.deepEqual(session.getSnapshot().mix.tracks, [])
})

test('unrelated settings preserve shelves; account changes discard old data and mixes', async () => {
  const { client, pages, setSettings } = mock()
  const session = createRecommendationSession(client)
  await session.ensure()
  await session.generate(24)
  const data = session.getSnapshot().data
  setSettings({ lastfm_username: 'listener', lastfm_enabled: '1', theme: 'light', playback_search_order: '["sc","yt"]' })
  await session.ensure()
  assert.equal(session.getSnapshot().data, data)
  setSettings({ lastfm_username: 'other', lastfm_enabled: '1' })
  await session.ensure()
  assert.equal(session.getSnapshot().mix.tracks.length, 0)
  assert.equal(pages.at(-1).page, 0)
})

test('artwork enrichment accumulates across batches and sections without refreshing providers', async () => {
  const { client, pages } = mock()
  client.discoveryArtwork = async items => items.map(item => ({ image: `https://images.example/${encodeURIComponent(item.title || item.artist)}` }))
  const session = createRecommendationSession(client)
  await session.ensure()
  for (let i = 0; i < 20 && !session.getSnapshot().data.freshFinds.at(-1).artwork_url; i++) await new Promise(resolve => setImmediate(resolve))
  assert.ok(session.getSnapshot().data.freshFinds.every(track => track.artwork_url))
  assert.ok(session.getSnapshot().data.quickPicks.every(track => track.artwork_url))
  assert.equal(pages.length, 1)
})
