import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyLoadingToastEvent, currentLoadingToast } from '../src/loadingToastState.mjs'

test('notifications cannot hide a pending percentage toast', () => {
  const pending = new Map()
  applyLoadingToastEvent(pending, { id: 'download-1', message: 'Downloading', loading: true, progress: 10 })
  assert.deepEqual(applyLoadingToastEvent(pending, { message: 'Added to playlist' }), { handled: false })
  assert.deepEqual(currentLoadingToast(pending), {
    id: 'download-1', message: 'Downloading', loading: true, progress: 10,
  })
  applyLoadingToastEvent(pending, { id: 'download-1', update: true, loading: true,
    message: 'Downloading', progress: 65 })
  assert.equal(currentLoadingToast(pending).id, 'download-1')
  assert.equal(currentLoadingToast(pending).progress, 65)
})

test('closing a different request never hides the active loading indicator', () => {
  const pending = new Map()
  applyLoadingToastEvent(pending, { id: 'first', message: 'First', loading: true })
  applyLoadingToastEvent(pending, { id: 'second', message: 'Second', loading: true, progress: 25 })
  applyLoadingToastEvent(pending, { finish: 'first' })
  assert.equal(currentLoadingToast(pending).id, 'second')
  applyLoadingToastEvent(pending, { finish: 'second' })
  assert.equal(currentLoadingToast(pending), null)
})

test('late updates from completed requests never restart the animation', () => {
  const pending = new Map()
  applyLoadingToastEvent(pending, { id: 'request', message: 'Loading', loading: true })
  applyLoadingToastEvent(pending, { finish: 'request' })
  const action = applyLoadingToastEvent(pending,
    { id: 'request', loading: true, update: true, message: 'Late', progress: 99 })
  assert.deepEqual(action, { handled: true })
  assert.equal(currentLoadingToast(pending), null)
})

test('completing latest request restores any still-active prior request', () => {
  const pending = new Map()
  applyLoadingToastEvent(pending, { id: 'first', message: 'Uploading', loading: true, progress: 33 })
  applyLoadingToastEvent(pending, { id: 'second', message: 'Downloading', loading: true, progress: 80 })
  applyLoadingToastEvent(pending, { finish: 'second', message: 'Downloaded' })
  assert.equal(currentLoadingToast(pending).id, 'first')
  assert.equal(currentLoadingToast(pending).progress, 33)
})
