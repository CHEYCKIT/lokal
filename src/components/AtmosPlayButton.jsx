import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayerStore } from '../store/player'

// Native HDMI passthrough; never routed through Chromium's PCM mixer.
export default function AtmosPlayButton({ track }) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [device, setDevice] = useState(() => {
    try { return localStorage.getItem('lokal-atmos-output-device') || '' }
    catch { return '' }
  })
  const [showDevice, setShowDevice] = useState(false)
  useEffect(() => api.onAtmosStatus(data => setStatus(data)), [])
  const active = status?.state === 'playing' && status?.id === String(track?.id)
  const start = async event => {
    event.stopPropagation()
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (active) {
        await api.atmosStop()
        return
      }
      // Electron deliberately does not support window.prompt().
      // Keep the device selection an in-app field with a persisted value.
      if (event.altKey) {
        setShowDevice(value => !value)
        return
      }
      const state = usePlayerStore.getState()
      if (state.isPlaying) state.togglePlay()
      const result = await api.atmosPlay(track.provider, String(track.id), device)
      if (!result?.ok) setError(result?.error || 'Atmos HDMI playback failed')
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {showDevice && (
        <input
          aria-label="Atmos HDMI output device"
          placeholder="wasapi/... · alsa/... · coreaudio/... (empty = default)"
          title="Run mpv --audio-device=help to find a suitable HDMI receiver; leave blank for system default."
          value={device}
          onClick={event => event.stopPropagation()}
          onChange={event => {
            const next = event.target.value
            setDevice(next)
            try { localStorage.setItem('lokal-atmos-output-device', next) } catch {}
          }}
          className="w-56 rounded bg-neutral-900 px-2 py-1 text-[11px] text-white"
        />
      )}
      <button type="button" disabled={busy}
        onClick={start}
        title="Play original Tidal E-AC-3 JOC over HDMI through mpv (Windows WASAPI, Linux ALSA or macOS CoreAudio). Requires an Atmos AVR and mpv installed. Alt-click to select HDMI device."
        className="rounded-full border border-violet-400/25 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-200 disabled:opacity-50">
        {busy || status?.state === 'loading' ? 'PREPARING ATMOS…' : active ? 'STOP ATMOS' : 'PLAY ATMOS'}
      </button>
      {error && <span title={error} className="max-w-[14rem] truncate text-[10px] text-red-400">{error}</span>}
    </span>
  )
}
