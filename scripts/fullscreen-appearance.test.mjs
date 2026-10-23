import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const player = readFileSync(new URL('../src/components/FullscreenPlayer.jsx', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const flowingGradient = readFileSync(new URL('../src/components/FullscreenGradientFlow.jsx', import.meta.url), 'utf8')

test('fullscreen CD and gradient settings are independent and default off', () => {
  for (const key of ['fullscreen_rotating_cd', 'fullscreen_moving_gradient']) {
    assert.ok(settings.includes("set('" + key + "'"))
    assert.ok(settings.includes("settings." + key + " === '1'"))
    assert.ok(player.includes("settings." + key + " === '1' && !performanceMode && !reduceMotion"))
  }
  assert.ok(player.includes("onWindowVisibility(setWindowHidden)"))
  assert.ok(player.includes("showFullscreen && !lyricsMode && isPlaying && !windowHidden"))
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'))
})

test('Spotify Canvas fills the square cover without expanding the card', () => {
  assert.ok(player.includes('style={{ width: coverSize, height: coverSize }}'))
  assert.ok(!player.includes("aspectRatio: '9 / 16'"))
  assert.ok(player.includes('only="tall" onActive={setFsCanvas}'))
  assert.ok(player.includes('rotatingCd && !fsCanvas && !squareMotionActive'))
})

test('lyrics width grows left without shifting the fullscreen cover', () => {
  assert.ok(player.includes("LYRICS_LEFT_EXPANSION = 'clamp(18px, 2vw, 32px)'"))
  assert.ok(player.includes("width: isPanelVisible ? PANEL_WIDTH : '0px'"))
  assert.ok(player.includes('marginLeft: `calc(-1 * ${LYRICS_LEFT_EXPANSION})`'))
  assert.ok(player.includes('width: `calc(100% + ${LYRICS_LEFT_EXPANSION})`'))
})

test('fullscreen gradient visibly flows while playback is paused, but stops when hidden', () => {
  assert.ok(player.includes('const gradientRunning = open && !windowHidden'))
  assert.ok(player.includes('<FullscreenGradientFlow trackId={currentTrack?.id} running={gradientRunning} />'))
  assert.ok(player.includes('animationPlayState: gradientRunning ? "running" : "paused"'))
  assert.ok(flowingGradient.includes('loadMesh(trackId)'))
  assert.ok(flowingGradient.includes("'--fullscreen-flow-state': running ? 'running' : 'paused'"))
  assert.ok(css.includes('fullscreen-gradient-flow-a'))
  assert.ok(css.includes('fullscreen-gradient-flow-b'))
  assert.ok(css.includes('mix-blend-mode: screen'))
})

test('rotating disc matches reference: white rim, white label circle and punched center hole', () => {
  assert.ok(player.includes('fullscreen-cd-artwork'))
  assert.ok(player.includes('fullscreen-cd-hole-outline'))
  assert.ok(css.includes('.fullscreen-cd-disc::before'))
  assert.ok(css.includes('.fullscreen-cd-disc::after'))
  assert.ok(css.includes('mask-image: radial-gradient(circle at center, transparent'))
  assert.ok(css.includes('border: 1.35px solid rgb(255 255 255 / 0.85)'))
  assert.ok(css.includes('border: 1.5px solid rgb(255 255 255 / 0.82)'))
  assert.ok(!css.includes('background: radial-gradient(circle, #101017'))
})
