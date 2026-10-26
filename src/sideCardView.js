/**
 * Choose the sidebar card to display after the current track changes.
 * Visualization persists; other modes select Lyrics only when lyric lines exist.
 * @param {string|null|undefined} view Previously selected card view.
 * @param {boolean} hasLyrics Whether the new track has lyric lines.
 * @returns {'visualization'|'lyrics'|'info'} The view to use for the new track.
 */
export function sideCardViewAfterTrackChange(view, hasLyrics = false) {
  if (view === 'visualization') return 'visualization'
  return hasLyrics ? 'lyrics' : 'info'
}

/**
 * Appearance > Layout > Sidebar Cards is independent from Side Panels
 * (Queue/Lyrics as full-height panels). Preserve the old one-card behavior
 * unless the user explicitly opts in to fused track metadata + lyrics.
 */
export const DEFAULT_SIDEBAR_CARD_LAYOUT = 'independent'

export function normalizeSidebarCardLayout(value) {
  return value === 'fused' ? 'fused' : DEFAULT_SIDEBAR_CARD_LAYOUT
}

/**
 * Visible cards in the compact Now Playing details pane, in display order.
 * In fused mode a manually selected visualizer remains accessible without
 * replacing the always-visible Info and available Lyrics cards.
 */
export function sidebarCardSections(layout, view, hasLyrics) {
  if (normalizeSidebarCardLayout(layout) === 'fused') {
    return [
      'info',
      ...(hasLyrics ? ['lyrics'] : []),
      ...(view === 'visualization' ? ['visualization'] : []),
    ]
  }
  return [view === 'lyrics' ? 'lyrics' : view === 'visualization' ? 'visualization' : 'info']
}
