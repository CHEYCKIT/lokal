/**
 * Ignore media events left over from an audio element's previous queue entry.
 * Chromium can deliver an ended/error event after the React state has already
 * advanced to the next track. The element is tagged when a new entry is
 * assigned so that event cannot advance the queue a second time.
 */
export function isAudioEventForTrack(target, currentTrackId) {
  if (target?.dataset?.lokalTrackPending) return false
  const elementTrackId = target?.dataset?.lokalTrackId
  return !elementTrackId || (currentTrackId != null && elementTrackId === String(currentTrackId))
}
