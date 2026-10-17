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
