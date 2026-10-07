import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import fullscreenSleep from '../electron/fullscreenSleepBlocker.js'

function fixture() {
  const app = new EventEmitter()
  const window = new EventEmitter()
  window.webContents = new EventEmitter()
  const state = { visible: true, minimized: false, destroyed: false }
  window.isVisible = () => state.visible
  window.isMinimized = () => state.minimized
  window.isDestroyed = () => state.destroyed
  const starts = [], stops = [], active = new Set()
  const powerSaveBlocker = {
    start: type => { const id = starts.length; starts.push(type); active.add(id); return id },
    stop: id => { stops.push(id); return active.delete(id) },
  }
  const dispose = fullscreenSleep.attachFullscreenSleepBlocker(window, { app, powerSaveBlocker })
  return { app, window, contents: window.webContents, state, starts, stops, active, dispose }
}

test('only whole-monitor HTML fullscreen blocks display/system sleep, regardless of playback state', () => {
  const f = fixture()
  for (const event of ['maximize', 'focus', 'show']) f.window.emit(event)
  for (const event of ['media-started-playing', 'media-paused']) f.contents.emit(event)
  assert.deepEqual(f.starts, [], 'ordinary player overlays and maximized windows need no blocker')
  f.window.emit('enter-full-screen')
  assert.deepEqual(f.starts, ['prevent-display-sleep'], 'native fullscreen also owns the blocker')
  f.window.emit('leave-full-screen')
  assert.deepEqual(f.stops, [0])
  f.contents.emit('enter-html-full-screen')
  assert.deepEqual(f.starts, ['prevent-display-sleep', 'prevent-display-sleep'])
  f.contents.emit('media-paused')
  f.contents.emit('enter-html-full-screen')
  f.window.emit('show')
  assert.equal(f.starts.length, 2, 'entry/show repeats cannot leak extra blockers')
  f.contents.emit('leave-html-full-screen')
  assert.deepEqual(f.stops, [0, 1], 'blocker ID zero is valid and must be released')
  assert.equal(f.active.size, 0)
  f.contents.emit('enter-html-full-screen')
  f.window.emit('leave-full-screen')
  f.contents.emit('leave-html-full-screen')
  assert.deepEqual(f.stops, [0, 1, 2], 'OS and HTML exit events release the request once')
})

test('hiding/minimizing releases the blocker and a still-fullscreen restore reacquires it once', () => {
  const f = fixture()
  f.contents.emit('enter-html-full-screen')
  f.state.minimized = true
  f.window.emit('minimize')
  assert.equal(f.active.size, 0)
  f.state.visible = false
  f.window.emit('hide')
  f.state.minimized = false
  f.window.emit('restore')
  assert.equal(f.active.size, 0, 'restoring a hidden window cannot inhibit sleep')
  f.state.visible = true
  f.window.emit('show')
  assert.equal(f.active.size, 1)
  assert.equal(f.starts.length, 2)
  f.state.visible = false
  f.window.emit('hide')
  f.contents.emit('leave-html-full-screen')
  f.state.visible = true
  f.window.emit('show')
  assert.equal(f.active.size, 0, 'showing a window that left fullscreen does not restart the blocker')
})

test('fullscreen entry while already hidden or minimized waits until the window is visible', () => {
  const f = fixture()
  f.state.minimized = true
  f.contents.emit('enter-html-full-screen')
  assert.equal(f.active.size, 0)
  f.state.minimized = false
  f.window.emit('restore')
  assert.equal(f.active.size, 1)
})

test('reloads and renderer failures clear fullscreen ownership, but in-page and subframe navigation preserve it', () => {
  const f = fixture()
  f.contents.emit('enter-html-full-screen')
  f.contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
  f.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
  assert.equal(f.active.size, 1)
  f.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  assert.equal(f.active.size, 0)
  f.window.emit('show')
  assert.equal(f.active.size, 0)
  f.contents.emit('enter-html-full-screen')
  f.contents.emit('render-process-gone', {}, { reason: 'crashed' })
  assert.equal(f.active.size, 0)
})

for (const event of ['closed', 'destroyed', 'will-quit']) {
  test(`${event} releases only this window's blocker and removes all lifecycle listeners`, () => {
    const f = fixture()
    const otherId = 999
    f.active.add(otherId)
    f.contents.emit('enter-html-full-screen')
    f.state.destroyed = true
    const target = event === 'closed' ? f.window : event === 'destroyed' ? f.contents : f.app
    target.emit(event)
    f.dispose()
    assert.deepEqual([...f.active], [otherId])
    assert.deepEqual(f.stops, [0])
    for (const target of [f.app, f.window, f.contents]) assert.deepEqual(target.eventNames(), [])
  })
}

test('a cancelled close or quit retains protection, and disposing a window allows clean macOS recreation', () => {
  const f = fixture()
  f.contents.emit('enter-html-full-screen')
  f.window.emit('close', { preventDefault() {} })
  f.app.emit('before-quit', { preventDefault() {} })
  assert.equal(f.active.size, 1)
  f.window.emit('closed')
  const nextWindow = new EventEmitter()
  nextWindow.webContents = new EventEmitter()
  nextWindow.isDestroyed = () => false
  nextWindow.isVisible = () => true
  nextWindow.isMinimized = () => false
  const ids = []
  const dispose = fullscreenSleep.attachFullscreenSleepBlocker(nextWindow, { app: f.app, powerSaveBlocker: { start: () => 55, stop: id => ids.push(id) } })
  nextWindow.webContents.emit('enter-html-full-screen')
  assert.equal(f.app.listenerCount('will-quit'), 1)
  f.app.emit('will-quit')
  assert.deepEqual(ids, [55])
  dispose()
})
