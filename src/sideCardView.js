// Keep only the standalone visualizer selected when tracks change.
// Lyrics belong to the current song, and the info card is the fallback.
export function sideCardViewAfterTrackChange(view) {
  return view === 'visualization' ? 'visualization' : 'info'
}
