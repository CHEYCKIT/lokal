import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { motionCacheKey } = require('../electron/artwork/motion.js')
const { canvasGraphqlAnswer } = require('../electron/artwork/spotify.js')

test('Canvas cache keys invalidate old misses and change when the Spotify cookie changes', () => {
  const track = { title: 'SPIN', artist: 'Kroi', album: 'SPIN' }
  const sources = ['apple', 'tidal', 'community', 'spotify']
  const first = motionCacheKey(track, sources, { spotify_sp_dc: 'cookie-one' })
  const second = motionCacheKey(track, sources, { spotify_sp_dc: 'cookie-two' })

  assert.match(first, /\\|v4\\|s4:[0-9a-f]{16}$/)
  assert.notEqual(first, second)
  assert.ok(!first.includes('cookie-one'))
  assert.ok(!second.includes('cookie-two'))
})

test('Canvas GraphQL distinguishes a real no-Canvas answer from an unusable response', () => {
  assert.deepEqual(
    canvasGraphqlAnswer({ data: { trackUnion: { canvas: null } } }),
    { url: null, canvas: null, failed: false },
  )
  assert.equal(canvasGraphqlAnswer({ data: { trackUnion: null } }).failed, true)
  assert.equal(canvasGraphqlAnswer({ data: { trackUnion: {} } }).failed, true)
  assert.equal(canvasGraphqlAnswer({ data: {}, errors: [{ message: 'Persisted query not found' }] }).failed, true)
  assert.equal(canvasGraphqlAnswer({ data: { trackUnion: { canvas: null } }, errors: [{ message: 'Partial failure' }] }).failed, true)
  assert.equal(
    canvasGraphqlAnswer({ data: { trackUnion: { canvas: { url: 'https://canvaz.scdn.co/clip.mp4', type: 'VIDEO' } } } }).url,
    'https://canvaz.scdn.co/clip.mp4',
  )
  assert.equal(canvasGraphqlAnswer({ data: { trackUnion: { canvas: { url: 'https://canvaz.scdn.co/clip.webm' } } } }).failed, true)
})

test('visible Canvas lookups refresh after settings save in sidebar and fullscreen', () => {
  const motionCover = readFileSync(new URL('../src/components/MotionCover.jsx', import.meta.url), 'utf8')
  const rightSidebar = readFileSync(new URL('../src/components/RightSidebar.jsx', import.meta.url), 'utf8')
  const fullscreen = readFileSync(new URL('../src/components/FullscreenPlayer.jsx', import.meta.url), 'utf8')
  assert.match(motionCover, /addEventListener\\('lokal:settings-saved', onSettingsSaved\\)/)
  assert.match(rightSidebar, /addEventListener\\('lokal:settings-saved', load\\)/)
  assert.match(fullscreen, /addEventListener\\('lokal:settings-saved', load\\)/)
})
