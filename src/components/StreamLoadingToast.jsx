import { useEffect } from 'react'
import { usePlayerStore } from '../store/player'
import { streamRef } from '../onlineTracks'
import { showLoadingToast } from './Toaster'
import { acceptStreamSignal, startupProgress, streamLoadKey } from '../streamStartupProgress.mjs'

// This percentage counts observed *stream startup milestones* (source search,
// media connection, headers, bytes, decoder readiness). It deliberately does
// NOT pretend chunked/streaming add-ons downloaded the whole song: Chromium
// often has no media duration, buffered ranges or Content-Length at startup.
//
// One toast belongs to a playback generation, NOT a source provider/id.
// Provider fallback keeps it alive and resets the per-source startup indicator.
export default function StreamLoadingToast() {
  useEffect(() => {
    let currentId = null
    let toast = null
    let startTimer = null
    let lastMessage = ''
    let lastPercent

    const close = () => {
      clearTimeout(startTimer)
      startTimer = null
      toast?.close()
      toast = null
      currentId = null
      lastMessage = ''
      lastPercent = undefined
    }
    const update = () => {
      const state = usePlayerStore.getState()
      const track = state.currentTrack
      const load = state.streamLoading
      const ref = !track?.atmosNative && streamRef(track)
      // While seeking another provider the previous audio element is stopped,
      // but the *track* is still loading. Do not dismiss its progress here.
      if (!load || !ref || state.castActive ||
          load.generation !== streamLoadKey(state) ||
          (!state.isBuffering && !load.recovering)) {
        close()
        return
      }
      // Fallback may supply different title metadata, but it is still the same
      // playback request. Never remount the toast on a provider/title change.
      const id = String(load.generation)
      if (currentId !== id) {
        close()
        currentId = id
        startTimer = setTimeout(() => {
          startTimer = null
          if (currentId === id) {
            toast = showLoadingToast(`Loading “${track.title}”…`)
            update()
          }
        }, 350)
      }
      if (!toast) return
      const attempt = Math.max(1, Number(load.attempt) || 1)
      const detail = load.message || ({
        preparing: 'Preparing playback',
        searching: 'Searching for a source',
        resolving: 'Resolving source',
        fetching: 'Connecting to the media server',
        headers: 'Media connection established',
        receiving: 'Receiving audio',
        decoding: 'Initializing decoder',
        ready: 'Ready to play',
      }[load.phase] || 'Starting stream')
      const prefix = attempt > 1 ? `Source ${attempt} · ` : ''
      // Source status percentage measures actual *completed startup stages*
      // rather than buffered media time, which can remain 0 for all of an
      // add-on's preparation before playback begins.
      const percent = startupProgress(load.phase, load.addonPercent)
      const message = `“${track.title}” · ${prefix}${detail} · startup`
      if (message !== lastMessage || percent !== lastPercent) {
        toast.update(message, percent)
        lastMessage = message
        lastPercent = percent
      }
    }

    const onStreamStartup = window.electron?.onStreamStartup?.(signal => {
      const state = usePlayerStore.getState()
      const ref = streamRef(state.currentTrack)
      if (!ref || state.streamLoading?.generation !== streamLoadKey(state)) return
      const key = `${ref.provider}:${ref.id}`
      const next = acceptStreamSignal(state.streamLoading, signal, key)
      if (next) state.setStreamLoading(next)
    })
    const interval = setInterval(update, 300)
    const unsubscribe = usePlayerStore.subscribe(update)
    update()
    return () => {
      clearInterval(interval)
      unsubscribe()
      onStreamStartup?.()
      close()
    }
  }, [])
  return null
}
