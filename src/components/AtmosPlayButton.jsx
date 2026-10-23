import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayerStore } from '../store/player'

// Native HDMI passthrough; never routed through Chromium's PCM mixer.
export default function AtmosPlayButton({ track }) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
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
      // Alt-click sets mpv's HDMI endpoint (wasapi/... or alsa/...).
      // Default endpoint works when HDMI/AVR is the OS's default output.
      let device = ''
      try {
        device = localStorage.getItem('lokal-atmos-output-device') || ''
        if (event.altKey) {
          const selected = window.prompt('mpv HDMI output device (wasapi/... or alsa/...). Empty = system default.', device)
          if (selected === null) return
          device = selected.trim()
          localStorage.setItem('lokal-atmos-output-device', device)
        }
      } catch {}
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
    <span className="inline-flex items-center gap-1">
      <button type="button" disabled={busy}
        onClick={start}
        title="Play original Tidal E-AC-3 JOC over HDMI through mpv (Windows WASAPI or Linux ALSA). Requires an Atmos AVR and mpv installed. Alt-click to select HDMI device."
        className="rounded-full border border-violet-400/25 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-200 disabled:opacity-50">
        {busy || status?.state === 'loading' ? 'PREPARING ATMOS…' : active ? 'STOP ATMOS' : 'PLAY ATMOS'}
      </button>
      {error && <span title={error} className="max-w-[14rem] truncate text-[10px] text-red-400">{error}</span>}
    </span>
  )
}
