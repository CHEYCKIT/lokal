import assert from 'node:assert/strict'
import test from 'node:test'
import { subscribeAnalyserReady } from '../src/visualizers/audio.js'

function withWindow(analyser, run) {
  const previous = globalThis.window
  const mockWindow = new EventTarget()
  mockWindow.__lokalAnalyser = analyser
  globalThis.window = mockWindow
  try { run(mockWindow) }
  finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
}

test('visualizer catches up when analyser exists before its ready listener mounts', () => {
  withWindow({ context: {} }, window => {
    let readyCount = 0
    const unsubscribe = subscribeAnalyserReady(() => { readyCount++ })
    assert.equal(readyCount, 1)
    window.dispatchEvent(new Event('lokal:analyser-ready'))
    assert.equal(readyCount, 1, 'the same ready state must not notify twice')
    unsubscribe()
  })
})

test('visualizer still reacts to an analyser created after subscription', () => {
  withWindow(null, window => {
    let readyCount = 0
    const unsubscribe = subscribeAnalyserReady(() => { readyCount++ })
    assert.equal(readyCount, 0)
    window.__lokalAnalyser = { context: {} }
    window.dispatchEvent(new Event('lokal:analyser-ready'))
    assert.equal(readyCount, 1)
    unsubscribe()
  })
})

test('known-ready mounts do not get a redundant immediate notification', () => {
  withWindow({ context: {} }, window => {
    let readyCount = 0
    const unsubscribe = subscribeAnalyserReady(() => { readyCount++ }, true)
    assert.equal(readyCount, 0)
    window.dispatchEvent(new Event('lokal:analyser-ready'))
    assert.equal(readyCount, 1)
    unsubscribe()
  })
})
