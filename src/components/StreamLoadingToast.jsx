import { useEffect } from 'react'
import { usePlayerStore } from '../store/player'
import { streamRef } from '../onlineTracks'
import { showLoadingToast } from './Toaster'
import { bufferedMediaPercent } from '../streamBufferProgress.mjs'

// Regular streaming: buffered media time is the only measurable percentage
// Chromium exposes. This is not total download completion. When the duration
// or ranges are unavailable the toast remains indeterminate, not fabricated.
export default function StreamLoadingToast() {
  useEffect(() => {
    let currentId = null
    let toast = null
    let startTimer = null
    let lastMessage = ''
    let lastPercent = undefined

    const close = () => {
      clearTimeout(startTimer)
      startTimer = null
      toast?.close()
      toast = null
      lastMessage = ''
      lastPercent = undefined
      currentId = null
    }
    const update = () => {
      const state = usePlayerStore.getState()
      const track = state.currentTrack
      const ref = !track?.atmosNative && streamRef(track)
      // Stream buffering often starts before isPlaying becomes true. Waiting
      // for isPlaying suppressed nearly every first-load percentage.
      if (!ref || !state.isBuffering) {
        close()
        return
      }
      const id = `${track.id}:${ref.provider}:${ref.id}`
      if (id !== currentId) {
        close()
        currentId = id
        startTimer = setTimeout(() => {
          startTimer = null
          if (currentId === id) {
            toast = showLoadingToast(`Loading “${track.title}”…`)
            lastMessage = ''
            lastPercent = undefined
            update()
          }
        }, 400)
      }
      if (!toast) return
      const element = state.activeAudioElement === 'cf'
        ? state.cfAudioRef?.current : state.audioRef?.current
      if (element?.dataset?.fallbackRecoveryPending === '1') { close(); return }
      const percent = bufferedMediaPercent(
        element?.buffered, element?.duration, track?.duration,
      )
      const message = percent === null
        ? `Loading “${track.title}”…`
        : `Buffering “${track.title}” · media time`
      if (lastMessage !== message || lastPercent !== percent) {
        // The progress indicator is a first-class value in the shared toast;
        // don't embed a duplicate percentage in its message.
        toast.update(message, percent)
        lastMessage = message
        lastPercent = percent
      }
    }
    const timer = setInterval(update, 400)
    const unsubscribe = usePlayerStore.subscribe(update)
    return () => { clearInterval(timer); unsubscribe(); close() }
  }, [])
  return null
}
