import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const player = readFileSync(new URL('../src/components/FullscreenPlayer.jsx', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

test('fullscreen CD stays optional; moving gradient setting and renderer are removed', () => {
  assert.ok(settings.includes("set('fullscreen_rotating_cd'"))
  assert.ok(settings.includes("settings.fullscreen_rotating_cd === '1'"))
  assert.ok(player.includes("settings.fullscreen_rotating_cd === '1' && !performanceMode && !reduceMotion"))
  assert.ok(player.includes('onWindowVisibility(setWindowHidden)'))
  assert.ok(player.includes('showFullscreen && !lyricsMode && isPlaying && !windowHidden'))
  assert.ok(player.includes('<ArtworkBackdrop trackId={currentTrack?.id} blur={64} />'))
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'))
  assert.ok(!settings.includes('fullscreen_moving_gradient'))
  assert.ok(!player.includes('fullscreen_moving_gradient'))
  assert.ok(!player.includes('FullscreenGradientFlow'))
  assert.ok(!css.includes('fullscreen-gradient-flow'))
  assert.ok(!css.includes('fullscreen-gradient-drift'))
})

test('Spotify Canvas fills the square cover without expanding the card', () => {
  assert.ok(player.includes('style={{ width: coverSize, height: coverSize }}'))
  assert.ok(!player.includes("aspectRatio: '9 / 16'"))
  assert.ok(player.includes('only="tall" onActive={setFsCanvas}'))
  assert.ok(player.includes('rotatingCd && !fsCanvas && !squareMotionActive'))
})

test('fullscreen cover retries original after same-ID artwork updates', () => {
  const cover = player.split('function FullscreenStillArtwork({ track }) {')[1]?.split('export default function FullscreenPlayer()')[0]
  assert.ok(cover, 'each fullscreen artwork layer must have its own fallback state')
  assert.ok(cover.includes('const full = trackFullArtURL(track) || trackArtURL(track)'))
  assert.ok(cover.includes('useEffect(() => setFailed(false), [track])'),
    'updated track objects must retry the original even when the original URL stays unchanged')
  assert.ok(cover.includes('src={failed ? fallback : full}'))
  assert.ok(cover.includes('fallback !== full'), 'avoid retry loops when both URLs coincide')
  assert.ok(!cover.includes('currentTarget.src'), 'do not mutate React-owned image sources')
  const perTrackCover = player.split('<MixCovers track={currentTrack} render={(track, { top }) => (')[1]
  assert.ok(perTrackCover.includes('<FullscreenStillArtwork track={track} />'))
  assert.ok(perTrackCover.includes('only="tall" onActive={setFsCanvas}'), 'preserve Canvas')
  assert.ok(perTrackCover.includes('fullscreen-cd-hole-outline'), 'preserve rotating CD')
})
test('side lyrics expand their invisible left boundary without changing artwork or font size', () => {
  const lyrics = readFileSync(new URL('../src/components/LyricsPanel.jsx', import.meta.url), 'utf8')
  assert.ok(player.includes('computeFullscreenLyricsExpansion'))
  assert.ok(player.includes('ref={coverStageRef}'))
  assert.ok(player.includes('ref={lyricsPanelRef}'))
  assert.ok(player.includes("width: isPanelVisible ? PANEL_WIDTH : '0px'"))
  assert.ok(player.includes('marginLeft: -lyricsLeftExpansion'))
  assert.ok(player.includes('width: `calc(100% + ${lyricsLeftExpansion}px)`'))
  assert.ok(player.includes('stretchFullscreenWidth'))
  assert.ok(player.includes('textScale={1.6}'))
  assert.ok(lyrics.includes("stretchFullscreenWidth ? 'px-6' : 'max-w-3xl mx-auto px-6'"))
  assert.ok(!player.includes('LYRICS_LEFT_EXPANSION'))
})

test('Spotify cookie editor is only in Integrations; Canvas links to it', () => {
  const cookieEditors = settings.match(/<Row\b[^>]*label=\{t\("Spotify Cookie"\)\}/g) || []
  assert.equal(cookieEditors.length, 1)
  assert.ok(settings.includes('id="spotify-cookie-settings"'))
  assert.ok(settings.includes("setActiveCategory('integrations')"))
  assert.ok(settings.includes("setSettingsQuery('')"))
  assert.ok(settings.includes("target.scrollIntoView({ behavior: 'smooth', block: 'center' })"))
  assert.ok(settings.includes('onClick={openSpotifyCookieSettings}'))
  assert.ok(settings.includes('Requires Spotify cookie: Settings → Integrations → Spotify'))
  const appearanceSection = settings.split('<Section title={t("Now Playing")}>')[1]?.split('</Section>')[0]
  assert.ok(appearanceSection)
  assert.ok(!appearanceSection.includes('type="password"'))
  assert.ok(!appearanceSection.includes('testSpotifyCanvas'))
  assert.ok(!appearanceSection.includes('fullscreen_moving_gradient'))
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
