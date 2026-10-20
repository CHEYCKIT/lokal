import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_ENABLED_VISUALIZERS, normalizeVisualizerModes } from '../src/visualizers/modes.mjs'

test('missing and invalid settings keep every visualizer available', () => {
  assert.deepEqual(normalizeVisualizerModes(undefined), DEFAULT_ENABLED_VISUALIZERS)
  assert.deepEqual(normalizeVisualizerModes('{bad json'), DEFAULT_ENABLED_VISUALIZERS)
  assert.deepEqual(normalizeVisualizerModes('[]'), DEFAULT_ENABLED_VISUALIZERS)
})

test('only known enabled visualizers are returned, without duplicates', () => {
  assert.deepEqual(
    normalizeVisualizerModes('["waves","milkdrop","waves","not-a-visualizer",3]'),
    ['waves', 'milkdrop'],
  )
})

test('an invalid or empty enabled list safely falls back to all modes', () => {
  assert.deepEqual(normalizeVisualizerModes(['invalid']), DEFAULT_ENABLED_VISUALIZERS)
  assert.deepEqual(normalizeVisualizerModes([]), DEFAULT_ENABLED_VISUALIZERS)
})
