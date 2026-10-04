/**
 * Fully detach the previous resource before reusing a media element. Merely
 * changing `src` can leave a decoded tail from the old resource in Chromium's
 * media pipeline, so the next queue entry may begin with the previous song.
 */
export function replaceAudioSource(element, source) {
  if (!element) return
  element.pause()
  element.removeAttribute('src')
  try { element.currentTime = 0 } catch {}
  element.load()
  element.src = source
  try { element.currentTime = 0 } catch {}
  element.load()
}

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
