import { playbackSpeed } from './playbackSpeed.mjs'

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
  let hold = false
  if (!element.seeking) {
    const drift = element.currentTime - target
    if (isStreamed(element) && element.readyState < 3 && Math.abs(drift) < WAIT_FOR_DATA_S) {
      // Still loading where it was sent (a streamed video's next piece takes
      // a second or two): seeking again would only throw that request away.
    } else if (isStreamed(element) && drift > 0.35 && drift < SEEK_LEAD_S + 0.6) {
      // A little ahead (it was sent ahead of the song): its frame waits for the song.
      hold = true
    } else if (Math.abs(drift) > 0.35) {
      // Somewhere not loaded yet: aim a moment ahead, so the picture is ready
      // when the song gets there instead of always arriving late.
      element.currentTime = isStreamed(element) && !isBuffered(element, target) ? target + SEEK_LEAD_S : target
      element.playbackRate = playbackSpeed()
    } else {
      const speed = playbackSpeed()
      element.playbackRate = Math.abs(drift) > 0.04 ? speed * (1 - Math.max(-0.06, Math.min(0.06, drift))) : speed
    }
  }
  if (isPlaying && !hidden && !hold && element.paused) element.play().catch(() => {})
  else if ((!isPlaying || hidden || hold) && !element.paused) element.pause()
  return { outside: false }
}

const WAIT_FOR_DATA_S = 10
const SEEK_LEAD_S = 1

// Streamed from YouTube (not a downloaded file): its data comes a piece at a time.
function isStreamed(element) {
  const src = String(element.currentSrc || element.src || '')
  return src.startsWith('lokal-stream:') || /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/ytv\//.test(src)
}

function isBuffered(element, time) {
  const ranges = element.buffered
  for (let i = 0; i < (ranges?.length || 0); i++) if (time >= ranges.start(i) && time <= ranges.end(i) - 0.1) return true
  return false
}

/** A seek preserves play/pause intent and lets both media elements resume. */
export function seekVideo(time, { state, element, segments }) {
  state.setProgressWithAudioUpdate(time)
  const segment = (segments || []).find(s => time >= s.start && (s.end == null || time < s.end))
  const target = segment ? time + segment.offset : null
  if (element?.readyState >= 1 && target != null && target >= 0) {
    element.currentTime = target
    element.playbackRate = playbackSpeed()
    if (state.isPlaying && element.paused) element.play().catch(() => {})
  }
  const audio = (state.activeAudioElement === 'primary' ? state.audioRef : state.cfAudioRef)?.current
  if (state.isPlaying && audio?.paused) audio.play().catch(() => {})
}
