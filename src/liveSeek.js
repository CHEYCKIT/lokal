// Seeking in a SpotiFLAC song that's still downloading (it plays as it
// arrives, see electron/spotiflac/media.js). Chromium reads the end of a FLAC
// file before any seek, and that only exists once the download is complete,
// so the seek waits: once the song is complete, it's reloaded at the
// position asked for (the complete copy seeks freely).

const STUCK_MS = 1200
const POLL_MS = 700

const tokens = new WeakMap()

/** For an audio element's `seeking` event. */
export function handleLiveSeek(element, { currentTrack, streamRef, isAddonProvider, prepare, streamURL, isPlaying }) {
  if (!element) return
  const token = () => tokens.get(element) || 0
  const ref = streamRef(currentTrack())
  if (!ref || !isAddonProvider(ref.provider)) return
  const mine = token() + 1
  tokens.set(element, mine)
  const src = element.getAttribute('src') || ''
  if (src.split('?')[0] !== streamURL(ref.provider, ref.id)) return
  ;(async () => {
    await new Promise(resolve => setTimeout(resolve, STUCK_MS))
    if (mine !== token() || !element.seeking) return
    // Still seeking: wait for the song to be complete.
    for (;;) {
      const state = await Promise.resolve(prepare(ref.provider, ref.id)).catch(() => null)
      if (mine !== token() || (element.getAttribute('src') || '') !== src) return
      if (!state || state.error || !element.seeking) return
      // Only a SpotiFLAC preparation waits like this; another source's slow
      // seek is left alone.
      if (!state.package) return
      if (state.ok && !state.live) break
      await new Promise(resolve => setTimeout(resolve, POLL_MS))
    }
    if (!element.seeking) return
    const target = element.currentTime
    const resume = isPlaying()
    // The reload's pause isn't the person pausing (see ignoreElementPause in App).
    element.dataset.fallbackPending = '1'
    element.src = `${streamURL(ref.provider, ref.id)}?complete=${Date.now()}`
    element.addEventListener('loadedmetadata', async () => {
      try {
        if (mine !== token()) return
        try { element.currentTime = target } catch {}
        if (resume) await element.play().catch(() => {})
      } finally { element.dataset.fallbackPending = '' }
    }, { once: true })
    element.load()
  })()
}
