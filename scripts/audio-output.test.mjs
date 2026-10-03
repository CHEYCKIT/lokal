import assert from 'node:assert/strict'
import { test } from 'node:test'
import { outputKind, outputLabel } from '../src/audioOutput.js'

test('output labels distinguish speakers and headsets without exposing blank device names', () => {
  assert.equal(outputKind('Realtek Speakers'), 'speaker')
  assert.equal(outputKind('USB Headset'), 'headphones')
  assert.equal(outputKind('WH-1000XM5 Bluetooth'), 'headphones')
  assert.equal(outputKind('Bluetooth Speaker'), 'speaker')
  assert.equal(outputLabel({ deviceId: 'default', label: '' }), 'System default')
  assert.equal(outputLabel({ deviceId: 'abc', label: '' }, 1), 'Audio output 2')
  assert.equal(outputLabel({ deviceId: 'abc', label: '  Desk speakers  ' }), 'Desk speakers')
})

test('explicit speaker wording wins over a Bluetooth qualifier', () => {
  assert.equal(outputKind('Bluetooth Speaker (High Definition Audio)'), 'speaker')
})
