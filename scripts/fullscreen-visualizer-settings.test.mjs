import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterMilkDropPresetNames,
  normalizeEnabledMilkDropPresets,
} from '../src/visualizers/milkDropPresets.mjs'

const presets = ['Classic Spiral', 'Fractal Dream', 'Neon Tunnel']

test('Idiot - Star of Annon is excluded from every MilkDrop preset list', () => {
  assert.deepEqual(
    filterMilkDropPresetNames([
      'Classic Spiral',
      'Idiot - Star of Annon',
      'idiot - star of annon',
      'Idiot-Star of Annon',
      'Neon Tunnel',
    ]),
    ['Classic Spiral', 'Neon Tunnel'],
  )
})

test('missing and malformed settings enable every available MilkDrop preset', () => {
  assert.deepEqual(normalizeEnabledMilkDropPresets(undefined, presets), presets)
  assert.deepEqual(normalizeEnabledMilkDropPresets('{bad json', presets), presets)
  assert.deepEqual(normalizeEnabledMilkDropPresets('[]', presets), presets)
})

test('a configured subset is preserved and duplicate or unknown names are removed', () => {
  assert.deepEqual(
    normalizeEnabledMilkDropPresets('["Fractal Dream","Classic Spiral","Fractal Dream","unknown",3]', presets),
    ['Fractal Dream', 'Classic Spiral'],
  )
})

test('an invalid or fully stale list safely falls back to all current presets', () => {
  assert.deepEqual(normalizeEnabledMilkDropPresets(['not-installed'], presets), presets)
  assert.deepEqual(normalizeEnabledMilkDropPresets([], presets), presets)
})

test('new preset-pack versions ignore saved names that no longer exist', () => {
  assert.deepEqual(
    normalizeEnabledMilkDropPresets(['Classic Spiral', 'removed preset'], presets),
    ['Classic Spiral'],
  )
})
