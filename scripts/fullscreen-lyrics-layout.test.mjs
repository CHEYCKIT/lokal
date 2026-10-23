import test from 'node:test'
import assert from 'node:assert/strict'
import { computeFullscreenLyricsExpansion } from '../src/fullscreenLyricsLayout.mjs'

test('measured 40% expansion leaves the other 60% of the original gap', () => {
  const panelLeft = 1140
  const coverRight = 964
  const textInset = 37
  const fullGap = panelLeft + textInset - coverRight // 213px to lyric text
  const extension = computeFullscreenLyricsExpansion({ panelLeft, coverRight, textInset })
  assert.equal(extension, 85)
  // Right edge of the panel is never altered, only its lyrics content starts sooner.
  assert.ok(Math.abs((panelLeft + textInset - extension - coverRight) / fullGap - 0.6) < 0.005)
})

test('responds to screen geometry rather than a hard-coded maximum of 32px', () => {
  assert.equal(computeFullscreenLyricsExpansion({ panelLeft: 1000, coverRight: 700, textInset: 36 }), 134)
  assert.equal(computeFullscreenLyricsExpansion({ panelLeft: 550, coverRight: 500, textInset: 36 }), 34)
})

test('never expands across artwork when there is no gap', () => {
  assert.equal(computeFullscreenLyricsExpansion({ panelLeft: 520, coverRight: 570, textInset: 36 }), 0)
  assert.equal(computeFullscreenLyricsExpansion({ panelLeft: 520, coverRight: 570 }), 0)
})

test('handles invalid or zero fraction inputs without changing layout', () => {
  assert.equal(computeFullscreenLyricsExpansion({ panelLeft: Number.NaN, coverRight: 500 }), 0)
  assert.equal(computeFullscreenLyricsExpansion({ panelLeft: 1000, coverRight: 700 }, 0), 0)
  assert.equal(computeFullscreenLyricsExpansion({ panelLeft: 1000, coverRight: 700 }, 2), 336)
})
