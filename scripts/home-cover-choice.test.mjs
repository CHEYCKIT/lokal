import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const selector = source('src/components/MadeForYou.jsx')
const coverFlow = source('src/components/CoverFlow.jsx')
const classic = source('src/components/ClassicMadeForYou.jsx')
const appearance = source('src/appearanceFlags.js')
const settings = source('src/pages/Settings.jsx')
const home = source('src/pages/Home.jsx')

test('Cover Flow is on by default and only explicit app settings select the carousel', () => {
  assert.match(appearance, /'home_cover_flow'\]/, 'Cover Flow must be a default-true appearance flag')
  assert.ok(appearance.includes('s[key] !== \'0\''), 'only explicitly saved Off can disable it')
  assert.ok(selector.includes("useAppearanceFlag('home_cover_flow')"))
  assert.ok(selector.includes('if (!coverFlow) return <ClassicMadeForYou'))
  assert.ok(selector.includes('<CoverFlow picks={picks}'), 'default path keeps Cover Flow')
  assert.ok(!selector.includes('useReducedMotion'), 'do not choose presentation from OS accessibility')
})

test('Appearance setting is persisted and refreshes the Home view', () => {
  assert.ok(settings.includes('<Section title={t("Home")}>'))
  assert.ok(settings.includes('label={t("Cover Flow")}'))
  assert.ok(settings.includes("set('home_cover_flow', settings.home_cover_flow === '0' ? '1' : '0')"))
  assert.ok(settings.includes("aria-pressed={settings.home_cover_flow !== '0'}"))
  assert.ok(settings.includes("const set = (k, v) =>"))
  assert.ok(settings.includes('queueSettings({ [k]: v })'), 'writes through existing persistent settings')
  assert.ok(settings.includes("window.dispatchEvent(new Event('lokal:settings-saved'))"))
  assert.ok(appearance.includes("window.addEventListener('lokal:settings-saved', refresh)"))
})

test('classic fallback is original cylindrical carousel, not flattened Cover Flow', () => {
  for (const feature of [
    'const ARC = 0.27',
    'const GAP = 0.08',
    'const MIN_SCALE = 0.72',
    'const SLOTS = [9, 7, 5]',
    'wrap(index - s, count)',
    'function centreAt(',
    'onPointerDown={onPointerDown}',
    'onPointerMove={onPointerMove}',
    'onPointerUp={onPointerUp}',
    'onWheel={onWheel}',
    'setPointerCapture?.(event.pointerId)',
    "event.key === 'ArrowRight'",
    'onPlay(index)',
    'onContextMenu={event => onContextMenu?.(event, pick.track)}',
  ]) {
    assert.ok(classic.includes(feature), 'restore original behavior: ' + feature)
  }
  assert.ok(classic.includes("aria-roledescription=\"carousel\""))
  assert.ok(!classic.includes('useReducedMotion'), 'OS setting must not alter carousel motion')
  assert.ok(!classic.includes('motion-safe:'), 'hover movement must not depend on OS preference')
})

test('Cover Flow no longer reads Windows Reduced Motion but keeps app Performance Mode', () => {
  assert.ok(!coverFlow.includes('useReducedMotion'))
  assert.ok(coverFlow.includes('const reduced = usePerformanceMode()'))
  assert.ok(!coverFlow.includes('WebkitBoxReflect'), '3D artwork stays intact without any reflections')
  assert.ok(coverFlow.includes('flowCoverGeometry(index - p, size, reduced)'))
})

test('both choices use identical song picks and playback and neither restores a heading', () => {
  assert.ok(selector.includes('picks={picks} onPlay={onPlay} onContextMenu={onContextMenu}'))
  assert.ok(selector.includes("aria-label={t('Made for you')}"), 'keep accessible shelf label')
  assert.ok(classic.includes("aria-label={t('Made for you')}"))
  assert.ok(!selector.includes('<h2'))
  assert.ok(!classic.includes('<h2'), 'do not restore removed visible Made for you heading')
  assert.ok(home.includes('const picks = madeForYou(uidKey, mixes)'))
  assert.ok(home.includes('onPlay={index => playQueue(pickTracks, index, madeForYouContext)}'))
  assert.ok(home.includes('onContextMenu={openPickMenu}'))
})
