import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { api } = await import('../src/api.js')
const { useRadioStore } = await import('../src/store/radio.js')
const { DEFAULT_RADIO_CATALOG_URL } = await import('../src/radio/stations.js')

const reset = () => useRadioStore.setState({ ready: false, url: '', catalog: null, updatedAt: 0, loading: false })
const wait = () => new Promise(resolve => setTimeout(resolve, 5))

test('first run: the default station list is downloaded, so there are stations', async () => {
  reset()
  const loaded = []
  api.radioGetCatalog = async () => ({ url: '', catalog: null, updatedAt: 0 })
  api.radioLoadCatalog = async url => { loaded.push(url); return { ok: true, url, catalog: { stations: [{ title: 'Radio Nova' }] }, updatedAt: 1 } }
  await useRadioStore.getState().init()
  await wait()
  assert.deepEqual(loaded, [DEFAULT_RADIO_CATALOG_URL])
  assert.equal(useRadioStore.getState().url, DEFAULT_RADIO_CATALOG_URL)
  assert.equal(useRadioStore.getState().catalog.stations.length, 1)
})

test('someone\'s own link is kept: nothing is downloaded over it', async () => {
  reset()
  let asked = 0
  api.radioGetCatalog = async () => ({ url: 'https://example.test/mine.json', catalog: { stations: [] }, updatedAt: 5 })
  api.radioLoadCatalog = async () => { asked++; return { ok: false } }
  await useRadioStore.getState().init()
  await wait()
  assert.equal(asked, 0)
  assert.equal(useRadioStore.getState().url, 'https://example.test/mine.json')
})

test('offline on first run: the default link is still what Settings shows, and it is tried again next time', async () => {
  reset()
  api.radioGetCatalog = async () => ({ url: '', catalog: null, updatedAt: 0 })
  api.radioLoadCatalog = async () => { throw new Error('offline') }
  await useRadioStore.getState().init()
  await wait()
  assert.equal(useRadioStore.getState().url, DEFAULT_RADIO_CATALOG_URL)
  assert.equal(useRadioStore.getState().catalog, null)
})
