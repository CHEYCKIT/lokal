import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TRACK_COLUMN_OPTIONS, trackColumnDefaults, trackColumnLayout, trackColumnPreferences } from '../src/trackColumns.js'

test('quality defaults on for playlists/library; only saved booleans override defaults', () => {
  assert.equal(trackColumnPreferences(undefined, true, true).quality, true)
  assert.equal(trackColumnPreferences(undefined).quality, false)
  assert.equal(trackColumnPreferences({ quality: false }, true).quality, false)
  const columns = trackColumnPreferences({ quality: 'false', title: false, album: false }, true)
  assert.equal(columns.quality, true)
  assert.equal('title' in columns, false)
  assert.equal('album' in columns, false)
})

test('a 384px list with both sidebars keeps quality and source and folds album under title', () => {
  const columns = trackColumnDefaults(true, true)
  const compact = trackColumnLayout(384 / 16, columns, { playlist: true, actionSlots: 8 })
  assert.equal(compact.quality, true)
  assert.equal(compact.source, true)
  assert.equal(compact.album, false)
  assert.equal(compact.actions, false)
  assert.equal(compact.added, false)
  assert.equal(columns.added, true, 'fitting never overwrites a saved preference')
  const wide = trackColumnLayout(1200 / 16, columns, { playlist: true, actionSlots: 8 })
  for (const key of ['album', 'quality', 'source', 'actions', 'added', 'grip', 'time', 'number']) assert.equal(wide[key], true, key)
})

test('turning every optional column off still leaves title, album, and the More menu', () => {
  const columns = Object.fromEntries(TRACK_COLUMN_OPTIONS.map(([key]) => [key, false]))
  const layout = trackColumnLayout(80, columns, { playlist: true, actionSlots: 8 })
  for (const [key] of TRACK_COLUMN_OPTIONS) if (key in layout) assert.equal(layout[key], false, key)
  assert.equal(layout.album, true)
  assert.equal(layout.template, 'minmax(0,3fr) minmax(0,2fr) 1.25rem')
  assert.equal(trackColumnLayout(18, columns).template, 'minmax(0,3fr) 1.25rem')
})

test('all preference combinations keep header/row grids within the available width', () => {
  const keys = TRACK_COLUMN_OPTIONS.map(([key]) => key)
  for (let mask = 0; mask < 2 ** keys.length; mask++) {
    const columns = Object.fromEntries(keys.map((key, i) => [key, !!(mask & (1 << i))]))
    for (const width of [18, 22, 24, 32, 44, 60, 90]) {
      for (const playlist of [false, true]) {
        const layout = trackColumnLayout(width, columns, { playlist, actionSlots: 8 })
        const cells = layout.template.split(' ')
        const fixed = cells.filter(cell => cell.endsWith('rem')).reduce((sum, cell) => sum + parseFloat(cell), 0)
        const roomForText = width - 2 - (cells.length - 1) * 0.5 - fixed
        assert.ok(roomForText >= 11 + (layout.album ? 8 : 0) - 0.001, `${mask}: ${width}rem ${layout.template}`)
        assert.ok(playlist || !layout.grip)
      }
    }
  }
})
