// Seamless looping for short clips (moving covers, canvases). A <video loop>
// seeks back to the start at the end, and Chromium stalls on that seek
// (frozen picture for a moment every time round). Instead two copies of the
// clip take turns: while one plays, the other waits paused on its first
// frame; just before the end it starts and is shown in the same frame, and
// the first goes back to the start to wait.
// Clips that aren't made to loop (the last frame is nothing like the first)
// get `fade` seconds of crossfade from their end into their start instead
// of a jump.

const LEAD = 0.075 // s before the end: two frames at 24-30 fps

/**
 * @param videos  two <video> elements with the same src; the first one plays
 *                and is visible, the second is hidden (visibility: hidden)
 * @param fade    seconds of crossfade at the loop (0: a straight cut)
 * @param onSwap  called with the video now playing
 * @returns a function that stops it
 */
export function seamlessLoop([first, second], { fade = 0, onSwap } = {}) {
  if (typeof first?.requestVideoFrameCallback !== 'function' || !second) {
    if (first) first.loop = true
    return () => {}
  }
  let active = first
  let stopped = false
  let switching = false
  let fadeTimer = null

  const restart = (video) => { video.currentTime = 0; video.play().catch(() => {}) }
  // A crossfade starts a little early: the other copy takes a moment to start.
  const leadFor = (video) => (fade > 0 && video.duration > fade * 3 ? fade + 0.2 : LEAD)

  const finish = (from, to) => {
    from.style.visibility = 'hidden'
    from.pause()
    from.currentTime = 0
    to.style.transition = ''
    active = to
    switching = false
    onSwap?.(to)
    watch(to)
  }

  const handoff = (from) => {
    if (stopped || switching || active !== from) return
    const to = from === first ? second : first
    // The other copy isn't ready to show a frame yet: a plain loop this time.
    if (to.readyState < 2) { restart(from); return }
    switching = true
    const crossfade = leadFor(from) > LEAD
    to.style.zIndex = '1'
    from.style.zIndex = '0'
    if (crossfade) { to.style.transition = ''; to.style.opacity = '0' }
    to.requestVideoFrameCallback(() => {
      if (stopped) return
      to.style.visibility = 'visible'
      if (!crossfade) { finish(from, to); return }
      // Fade the start in over the end, then let the end go.
      void to.offsetWidth
      to.style.transition = `opacity ${fade}s linear`
      to.style.opacity = '1'
      fadeTimer = setTimeout(() => { if (!stopped) finish(from, to) }, fade * 1000)
    })
    to.play().catch(() => { switching = false; to.style.opacity = '1'; restart(from) })
  }

  const watch = (video) => {
    const onFrame = (_, meta) => {
      if (stopped || active !== video) return
      if (video.duration && meta.mediaTime >= video.duration - leadFor(video)) handoff(video)
      else video.requestVideoFrameCallback(onFrame)
    }
    video.requestVideoFrameCallback(onFrame)
  }

  // A missed frame callback (the window was hidden): the end still hands off.
  const onEnded = (e) => handoff(e.currentTarget)
  first.addEventListener('ended', onEnded)
  second.addEventListener('ended', onEnded)
  watch(first)
  return () => {
    stopped = true
    clearTimeout(fadeTimer)
    first.removeEventListener('ended', onEnded)
    second.removeEventListener('ended', onEnded)
  }
}
