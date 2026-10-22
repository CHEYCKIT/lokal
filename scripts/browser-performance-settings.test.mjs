import test from 'node:test'
import assert from 'node:assert/strict'
import { loadBrowserPerformanceSettings as load, saveBrowserPerformanceSettings as save, onBrowserPerformanceSettings as listen } from '../src/browserPerformanceSettings.mjs'

function browser() {
  const values = new Map()
  const host = new EventTarget()
  host.localStorage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) }
  return host
}

test('performance mode persists, broadcasts immediately and merges independent fields', () => {
  const host = browser(), updates = []
  const unsubscribe = listen(s => updates.push(s), host)
  assert.deepEqual(save({ performanceMode: true }, host), { success: true })
  save({ hardwareAcceleration: false }, host)
  assert.deepEqual(load(host), { performanceMode: true, hardwareAcceleration: false })
  assert.equal(updates.length, 2)
  assert.equal(updates[0].performanceMode, true)
  unsubscribe()
  save({ performanceMode: false }, host)
  assert.equal(updates.length, 2)
})

test('storage denial is reported rather than claiming the toggle saved', () => {
  const host = browser()
  host.localStorage.setItem = () => { throw new Error('storage denied') }
  assert.deepEqual(save({ performanceMode: true }, host), { error: 'storage denied' })
})
