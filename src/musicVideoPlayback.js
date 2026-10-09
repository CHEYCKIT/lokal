// The song remains the playback clock. Following it must never pause its audio
// element: that emits a real Pause and changes the player's intended state.
export function syncVideo(element, { time, segments, isPlaying, hidden = false, duration }) {
  if (!element || element.readyState < 1) return null
  const segment = (segments || []).find(s => time >= s.start && (s.end == null || time < s.end))
  const target = segment ? time + segment.offset : null
  const end = Number.isFinite(element.duration) ? element.duration : duration
  if (target == null || target < 0 || (end > 0 && target > end - 0.05)) {
    if (!element.paused) element.pause()
    return { outside: true }
  }
  // Don't restart an in-flight seek every 200 ms; allow the first frame to land.
  if (!element.seeking) {
    const drift = element.currentTime - target
    if (Math.abs(drift) > 0.35) {
      element.currentTime = target
      element.playbackRate = 1
    } else {
      element.playbackRate = Math.abs(drift) > 0.04 ? 1 - Math.max(-0.06, Math.min(0.06, drift)) : 1
    }
  }
  if (isPlaying && !hidden && element.paused) element.play().catch(() => {})
  else if ((!isPlaying || hidden) && !element.paused) element.pause()
  return { outside: false }
}

/** A seek preserves play/pause intent and lets both media elements resume. */
export function seekVideo(time, { state, element, segments }) {
  state.setProgressWithAudioUpdate(time)
  const segment = (segments || []).find(s => time >= s.start && (s.end == null || time < s.end))
  const target = segment ? time + segment.offset : null
  if (element?.readyState >= 1 && target != null && target >= 0) {
    element.currentTime = target
    element.playbackRate = 1
    if (state.isPlaying && element.paused) element.play().catch(() => {})
  }
  const audio = (state.activeAudioElement === 'primary' ? state.audioRef : state.cfAudioRef)?.current
  if (state.isPlaying && audio?.paused) audio.play().catch(() => {})
}
