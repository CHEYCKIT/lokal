import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayerStore } from '../store/player'

// Dedicated bitstream output. Dolby Atmos for Headphones needs a separate
// Windows Media Foundation / Spatial Audio renderer, not WASAPI passthrough.
export default function AtmosPlayButton({ track }) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [capability, setCapability] = useState(null)
  const [devices, setDevices] = useState([])
  const [deviceError, setDeviceError] = useState('')
  const [device, setDevice] = useState(() => {
    try { return localStorage.getItem('lokal-atmos-output-device') || '' }
    catch { return '' }
  })

  useEffect(() => api.onAtmosStatus(data => setStatus(data)), [])
  const active = status?.state === 'playing' && status?.id === String(track?.id)

  const refreshSetup = useCallback(async () => {
    try {
      const found = await api.atmosCapabilities()
      setCapability(found)
      setDeviceError('')
      if (found?.available) {
        const outputs = await api.atmosDevices()
        setDevices(outputs?.devices || [])
        if (outputs?.error) setDeviceError(outputs.error)
      } else setDevices([])
    } catch (err) { setDeviceError(err.message || String(err)) }
  }, [])

  const openSetup = async event => {
    event.stopPropagation()
    event.preventDefault()
    if (setupOpen) return setSetupOpen(false)
    setSetupOpen(true)
    await refreshSetup()
  }

  const chooseMpv = async event => {
    event.stopPropagation()
    setError('')
    const result = await api.atmosChooseMpv()
    if (result?.error) setError(result.error)
    if (result?.ok) await refreshSetup()
  }

  const start = async event => {
    event.stopPropagation()
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (active) return await api.atmosStop()
      const capabilities = await api.atmosCapabilities()
      if (!capabilities?.available) {
        setSetupOpen(true)
        await refreshSetup()
        setError('mpv is not installed or not detected. Locate mpv.exe to enable HDMI Atmos output.')
        return
      }
      const state = usePlayerStore.getState()
      // Stop regular PCM before opening the receiver in exclusive mode.
      const resumeTrack = state.currentTrack?.id
      const wasPlaying = !!state.isPlaying
      if (wasPlaying) state.togglePlay()
      const result = await api.atmosPlay(track.provider, String(track.id), device)
      if (!result?.ok) {
        if (wasPlaying && usePlayerStore.getState().currentTrack?.id === resumeTrack &&
            !usePlayerStore.getState().isPlaying) usePlayerStore.getState().togglePlay()
        setError(result?.error || 'Atmos HDMI playback failed')
        setSetupOpen(true)
        await refreshSetup()
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally { setBusy(false) }
  }

  const openFile = async event => {
    event.stopPropagation()
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const state = usePlayerStore.getState()
      const resumeTrack = state.currentTrack?.id
      const wasPlaying = !!state.isPlaying
      // Exclusive HDMI playback cannot be established while Chromium is
      // holding the same audio endpoint. Restore PCM if the dialog is
      // cancelled or opening the native player fails.
      if (wasPlaying) state.togglePlay()
      const result = await api.atmosOpenFile(device)
      if (!result?.ok && wasPlaying && usePlayerStore.getState().currentTrack?.id === resumeTrack &&
          !usePlayerStore.getState().isPlaying) usePlayerStore.getState().togglePlay()
      if (result?.error) setError(result.error)
    } catch (err) { setError(err.message || String(err)) }
    finally { setBusy(false) }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1" onClick={e => e.stopPropagation()}>
      <button type="button" disabled={busy} onClick={start}
        title="Play the original Tidal E-AC-3 JOC via mpv to an Atmos-capable HDMI receiver (not headphone virtualization)."
        className="rounded-full border border-violet-400/25 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-200 disabled:opacity-50">
        {busy || status?.state === 'loading' ? 'PREPARING ATMOS…' : active ? 'STOP ATMOS' : 'PLAY ATMOS'}
      </button>
      <button type="button" onClick={openSetup} aria-expanded={setupOpen}
        title="Configure mpv and select the HDMI Atmos receiver"
        className="rounded-full border border-violet-400/25 px-2 py-0.5 text-[10px] text-violet-200">
        ATMOS SETUP
      </button>
      {error && <span title={error} className="max-w-[18rem] text-[10px] text-red-400">{error}</span>}
      {setupOpen && (
        <span className="flex w-full max-w-sm flex-col gap-2 rounded-lg border border-white/15 bg-neutral-950 p-3 text-[11px] text-white">
          <span className="font-semibold">Windows / desktop · HDMI Atmos passthrough</span>
          <span className="text-white/65">Requires mpv and a receiver that accepts Dolby Digital Plus Atmos over HDMI. Dolby Atmos for Headphones uses a different Windows playback API.</span>
          <span>{capability?.mpvAvailable ? 'mpv detected' : 'mpv not detected'}</span>
          <span className="flex flex-wrap gap-2">
            <button type="button" onClick={chooseMpv}
              className="rounded border border-white/30 px-2 py-1">Locate mpv executable…</button>
            <a href="https://mpv.io/installation/" target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()} className="px-2 py-1 underline">Install mpv</a>
          </span>
          {capability?.mpvAvailable && (
            <>
              <label htmlFor={'atmos-device-' + String(track?.id)} className="font-medium">Audio output</label>
              <select id={'atmos-device-' + String(track?.id)} value={device}
                onChange={e => {
                  const value = e.target.value
                  setDevice(value)
                  try { localStorage.setItem('lokal-atmos-output-device', value) } catch {}
                }}
                className="w-full rounded border border-white/25 bg-neutral-900 p-2 text-white">
                <option value="">System default (may not be HDMI)</option>
                {devices.map(output => <option key={output.id} value={output.id}>{output.label}</option>)}
                {device && !devices.some(output => output.id === device) &&
                  <option value={device}>{device} (previous selection)</option>}
              </select>
              <span className="text-white/55">Use the HDMI-connected receiver. mpv confirms bitstream output when playback starts.</span>
              {deviceError && <span className="text-red-400">{deviceError}</span>}
              <button type="button" onClick={openFile} disabled={busy}
                className="self-start rounded border border-violet-400/40 px-2 py-1 text-violet-200 disabled:opacity-50">
                Open local Atmos file…
              </button>
            </>
          )}
        </span>
      )}
    </span>
  )
}
