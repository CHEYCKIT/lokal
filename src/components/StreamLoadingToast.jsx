import { useEffect } from 'react'
import { usePlayerStore } from '../store/player'
import { streamRef } from '../onlineTracks'
import { showLoadingToast } from './Toaster'

// Browsers don't expose a byte-accurate fetch percentage for range-streamed
// audio. The percent shown here is buffered MEDIA TIME / track duration,
// explicitly labelled so it cannot be mistaken for network-transfer progress.
export default function StreamLoadingToast() {
  useEffect(() => {
    let currentId = null
    let toast = null
    let startTimer = null
    let lastMessage = ''
    const close = () => {
      clearTimeout(startTimer)
      startTimer = null
      toast?.close()
      toast = null
      lastMessage = ''
      currentId = null
    }
    const update = () => {
      const state = usePlayerStore.getState()
      const track = state.currentTrack
      const ref = streamRef(track)
      if (!ref || !state.isBuffering || !state.isPlaying) {
        close()
        return
      }
      const id = `${track.id}:${ref.provider}:${ref.id}`
      if (id !== currentId) {
        close()
        currentId = id
        // Don't flash a toast for streams that start in a few milliseconds.
        startTimer = setTimeout(() => {
          startTimer = null
          if (currentId === id) toast = showLoadingToast(`Loading “${track.title}”…`)
        }, 400)
      }
      if (!toast) return
      const element = state.activeAudioElement === 'cf' ? state.cfAudioRef?.current : state.audioRef?.current
      if (element?.dataset?.fallbackRecoveryPending === '1') { close(); return }
      let percent = null
      const duration = Number(element?.duration)
      const buffered = element?.buffered
      if (buffered && Number.isFinite(duration) && duration > 0) {
        // Seeking to a late range doesn't mean earlier audio is buffered.
        // Sum non-overlapping buffered intervals rather than using the last
        // endpoint, which might make 10 seconds look like 95% of a track.
        let bufferedSeconds = 0
        let previousEnd = 0
        for (let i = 0; i < buffered.length; i++) {
          const start = Math.max(0, buffered.start(i), previousEnd)
          const end = Math.min(duration, buffered.end(i))
          if (end > start) bufferedSeconds += end - start
          previousEnd = Math.max(previousEnd, end)
        }
        percent = Math.max(0, Math.min(100, Math.floor(bufferedSeconds / duration * 100)))
      }
      const message = percent === null
        ? `Loading “${track.title}”…`
        : `Loading “${track.title}” · ${percent}% buffered`
      if (lastMessage !== message) { toast.update(message); lastMessage = message }
    }
    const timer = setInterval(update, 400)
    const unsubscribe = usePlayerStore.subscribe(update)
    return () => { clearInterval(timer); unsubscribe(); close() }
  }, [])
  return null
}
