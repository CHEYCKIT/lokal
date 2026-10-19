import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { configureMprisIdentity } = require('../electron/mpris')

test('configures Chromium MPRIS identity as Lokal on Linux', () => {
  const calls = []
  const app = { commandLine: { appendSwitch: (...args) => calls.push(args) } }
  assert.equal(configureMprisIdentity(app, 'linux'), true)
  assert.deepEqual(calls, [['mpris-name', 'lokal']])
})

test('does not alter Chromium media identity on Windows or macOS', () => {
  for (const platform of ['win32', 'darwin']) {
    const calls = []
    const app = { commandLine: { appendSwitch: (...args) => calls.push(args) } }
    assert.equal(configureMprisIdentity(app, platform), false)
    assert.deepEqual(calls, [])
  }
})
