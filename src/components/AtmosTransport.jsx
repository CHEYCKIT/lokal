import { useEffect } from 'react'
import { api } from '../api'
import { showLoadingToast, showToast } from './Toaster'
import { setOutputRoute, usePlayerStore } from '../store/player'

/**
 * Native Atmos is an output backend of the existing Lokal player, not a
 * second transport. Bar/fullscreen/mini/SMTC all share the Zustand queue,
 * playback state, clock and seek controls. JOC never enters Chromium PCM.
 */
export default function AtmosTransport() {
  useEffect(() => {
    let active = false
    let paused = false
    let toast = null
    let updatingFromBackend = false
    const route = {
      type: 'atmos',
      seek: seconds => {
        const clamped = Math.max(0, Math.min(999999, Number(seconds) || 0))
        api.atmosCommand('seek ' + clamped.toFixed(2) + ' absolute').catch(() => {})
      },
      // HDMI compressed passthrough is volume-controlled by the receiver.
      // The Windows native headphone renderer accepts a normal 0..1 gain.
      setVolume: level => {
        if (usePlayerStore.getState().currentTrack?.atmosMode !== 'headphones') return
        const value = Math.max(0, Math.min(1, Number(level) || 0))
        api.atmosCommand('volume ' + value.toFixed(3)).catch(() => {})
      },
    }
    const setPlayer = patch => {
      updatingFromBackend = true
      usePlayerStore.setState(patch)
      updatingFromBackend = false
    }
    const handleStatus = next => {
      const state = usePlayerStore.getState()
      const current = state.currentTrack
      // An old session can finish while a new track/stream is starting.
      if (!current?.atmosNative) return
      if (next?.id && String(next.id) !== String(current.atmosSourceId)) return
      if (next.state === 'loading') {
        active = true
        paused = false
        setOutputRoute(route)
        setPlayer({ isBuffering: true })
        if (!toast) toast = showLoadingToast('Preparing Dolby Atmos…')
        const percent = next.percent == null ? null : Number(next.percent)
        const measured = Number.isFinite(percent) && percent >= 0 && percent <= 100
        const phase = /segments/i.test(next.message || '')
          ? 'Downloading Dolby Atmos segments'
          : /download/i.test(next.message || '') || measured
            ? 'Downloading Dolby Atmos' : (next.message || 'Preparing Dolby Atmos…')
        toast.update(phase, measured ? Math.round(percent) : null)
        return
      }
      if (next.state === 'playing') {
        active = true
        paused = false
        setOutputRoute(route)
        toast?.close()
        toast = null
        setPlayer({ isPlaying: true, isBuffering: false })
        return
      }
      if (next.state === 'progress') {
        if (!active) return
        const position = Number(next.position)
        const duration = Number(next.duration)
        const update = {
          ...(Number.isFinite(position) && position >= 0 ? { progress: position } : {}),
          ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
        }
        if (next.mode === 'headphones' && typeof next.paused === 'boolean') {
          paused = next.paused
          update.isPlaying = !paused
        }
        if (Object.keys(update).length) setPlayer(update)
        return
      }
      if (next.state === 'error') {
        toast?.close()
        toast = null
        active = false
        setOutputRoute(null)
        setPlayer({ isPlaying: false, isBuffering: false })
        showToast(next.error || 'Native Dolby Atmos playback failed')
        return
      }
      if (next.state === 'ended' || (next.state === 'stopped' && active)) {
        toast?.close()
        toast = null
        active = false
        setOutputRoute(null)
        if (next.state === 'ended' && state.currentTrack?.atmosNative) {
          // Same queue/repeat/shuffle rules as regular playback.
          state.autoNext()
        } else {
          setPlayer({ isPlaying: false, isBuffering: false })
        }
      }
    }
    const off = api.onAtmosStatus(handleStatus)
    const localStarted = event => handleStatus(event.detail)
    window.addEventListener('lokal:atmos-local-ready', localStarted)
    const unsubscribe = usePlayerStore.subscribe((now, before) => {
      if (before.currentTrack?.atmosNative &&
          (now.currentTrack?.id !== before.currentTrack?.id ||
            now.currentTrack?.atmosNative !== before.currentTrack?.atmosNative)) {
        active = false
        setOutputRoute(null)
        toast?.close()
        toast = null
        api.atmosStop().catch(() => {})
        return
      }
      if (updatingFromBackend || !active || !now.currentTrack?.atmosNative) return
      // Zustand's togglePlay handles every local/media-key/sleep-timer
      // control, so forward only genuine user requested state transitions.
      if (now.isPlaying !== before.isPlaying && paused === now.isPlaying) {
        paused = !now.isPlaying
        api.atmosCommand('cycle pause').catch(() => {
          setPlayer({ isPlaying: before.isPlaying })
        })
      }
    })
    return () => {
      unsubscribe()
      off?.()
      window.removeEventListener('lokal:atmos-local-ready', localStarted)
      toast?.close()
      setOutputRoute(null)
    }
  }, [])
  return null
}
