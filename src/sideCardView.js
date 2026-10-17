/**
 * Choose the sidebar card to display after the current track changes.
 * Only the standalone visualizer persists; lyrics and other views return to info.
 * @param {string|null|undefined} view Previously selected card view.
 * @returns {'visualization'|'info'} The view to use for the new track.
 */
export function sideCardViewAfterTrackChange(view) {
  return view === 'visualization' ? 'visualization' : 'info'
}
