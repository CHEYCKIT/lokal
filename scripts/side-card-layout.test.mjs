import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_SIDEBAR_CARD_LAYOUT,
  normalizeSidebarCardLayout,
  sidebarCardSections,
  sideCardViewAfterTrackChange,
} from '../src/sideCardView.js'

test('Independent is the default and retains the original card selection', () => {
  assert.equal(DEFAULT_SIDEBAR_CARD_LAYOUT, 'independent')
  for (const unknown of [undefined, null, '', 'garbage', 'merged']) {
    assert.equal(normalizeSidebarCardLayout(unknown), 'independent')
  }
  assert.deepEqual(sidebarCardSections('independent', 'info', true), ['info'])
  assert.deepEqual(sidebarCardSections('independent', 'lyrics', true), ['lyrics'])
  assert.deepEqual(sidebarCardSections('independent', 'visualization', true), ['visualization'])
  assert.deepEqual(sidebarCardSections('independent', 'info', false), ['info'])
  assert.equal(sideCardViewAfterTrackChange('info', true), 'lyrics')
  assert.equal(sideCardViewAfterTrackChange('lyrics', false), 'info')
})

test('Fused always displays Info and available Lyrics together, in order', () => {
  assert.equal(normalizeSidebarCardLayout('fused'), 'fused')
  for (const previousCard of ['info', 'lyrics']) {
    assert.deepEqual(sidebarCardSections('fused', previousCard, true), ['info', 'lyrics'])
    assert.deepEqual(sidebarCardSections('fused', previousCard, false), ['info'])
  }
})

test('Fused keeps an explicitly enabled visualizer without displacing track details', () => {
  assert.deepEqual(sidebarCardSections('fused', 'visualization', true), ['info', 'lyrics', 'visualization'])
  assert.deepEqual(sidebarCardSections('fused', 'visualization', false), ['info', 'visualization'])
  assert.deepEqual(sidebarCardSections('independent', 'visualization', false), ['visualization'])
})

test('Card setting does not replace separate Side Panels mode', () => {
  const settings = readFileSync(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8')
  const sidebar = readFileSync(new URL('../src/components/RightSidebar.jsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(settings, /label=\{t\("Sidebar Cards"\)\}/)
  assert.match(settings, /set\('sidebar_card_layout', value\)/)
  assert.match(sidebar, /sidebarCardSections\(sidebarCardLayout, infoCardView, songHasLyrics\)/)
  assert.match(sidebar, /visibleCards\.includes\('info'\)/)
  assert.match(sidebar, /visibleCards\.includes\('lyrics'\)/)
  assert.match(sidebar, /<LyricsPanel track=\{currentTrack\} progress=\{progress\}/)
  assert.match(app, /!exclusiveSidePanels && <LyricsSidePanel\s*\/>/)
  assert.match(app, /!exclusiveSidePanels && <QueuePanel\s*\/>/)
})
