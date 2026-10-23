// Pixel geometry for the fullscreen player's side lyrics.
// Extends the *left* edge of the lyrics content; the cover, panel right edge,
// and font metrics are unchanged. Inputs are untransformed layout coordinates.
export function computeFullscreenLyricsExpansion({ panelLeft, coverRight, textInset = 36 }, fraction = 0.4) {
  if (![panelLeft, coverRight, textInset, fraction].every(Number.isFinite)) return 0
  if (fraction <= 0) return 0
  // Distance from the artwork to where an unexpanded lyric line starts.
  const gap = Math.max(0, panelLeft + textInset - coverRight)
  return Math.round(gap * Math.min(1, fraction))
}
