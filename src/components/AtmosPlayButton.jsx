import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { usePlayerStore } from '../store/player'

// The HDMI route uses mpv compressed passthrough. Headphones use native
// Windows MediaPlayer/Media Foundation with the installed Spatial Sound engine.
export default function AtmosPlayButton({ track, onPlay }) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem('lokal-atmos-output-mode') === 'headphones' ? 'headphones' : 'hdmi' }
    catch { return 'hdmi' }
  })
  const [setupOpen, setSetupOpen] = useState(false)
  const [capability, setCapability] = useState(null)
  const [devices, setDevices] = useState([])
  const [deviceError, setDeviceError] = useState('')
  const [device, setDevice] = useState(() => {
    try { return localStorage.getItem('lokal-atmos-output-device') || '' }
    catch { return '' }
  })

  useEffect(() => api.onAtmosStatus(data => setStatus(data)), [])
  useEffect(() => {
    if (!setupOpen) return undefined
    const closeOnEscape = event => { if (event.key === 'Escape') setSetupOpen(false) }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [setupOpen])
  const active = status?.state === 'playing' && status?.id === String(track?.id)

  const refreshSetup = useCallback(async () => {
    try {
      const found = await api.atmosCapabilities()
      setCapability(found)
      setDeviceError('')
      if (found?.mpvAvailable) {
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
      if (active) {
        await api.atmosStop()
        usePlayerStore.setState({ isPlaying: false, isBuffering: false })
        return
      }
      const capabilities = await api.atmosCapabilities()
      if ((mode === 'hdmi' && !capabilities?.mpvAvailable) ||
          (mode === 'headphones' && !capabilities?.headphones?.available)) {
        setSetupOpen(true)
        await refreshSetup()
        setError(mode === 'hdmi'
          ? 'mpv is not detected. Locate mpv.exe to enable HDMI output.'
          : 'Windows native headphone playback is unavailable in this Lokal build.')
        return
      }
      const result = onPlay
        ? await onPlay(mode, device)
        : { error: 'Atmos track cannot be inserted into the player queue' }
      if (!result?.ok) {
        setError(result?.error || 'Atmos playback failed')
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
      const result = await api.atmosOpenFile(device, mode)
      if (result?.ok && result.file && result.id) {
        const nativeTrack = {
          id: `atmos:${result.id}`,
          title: result.title || 'Dolby Atmos',
          artist: '',
          album: '',
          file_path: result.file,
          file_type: 'E-AC-3 JOC',
          atmosNative: true,
          atmosMode: mode,
          atmosProvider: 'local',
          atmosSourceId: result.id,
        }
        usePlayerStore.getState().playTrack(nativeTrack, [nativeTrack])
        window.dispatchEvent(new CustomEvent('lokal:atmos-local-ready', {
          detail: { state: 'playing', id: result.id, mode },
        }))
        setSetupOpen(false)
      } else {
        if (wasPlaying && usePlayerStore.getState().currentTrack?.id === resumeTrack &&
            !usePlayerStore.getState().isPlaying) usePlayerStore.getState().togglePlay()
        if (result?.error) setError(result.error)
      }
    } catch (err) { setError(err.message || String(err)) }
    finally { setBusy(false) }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1" onClick={e => e.stopPropagation()}>
      <button type="button" disabled={busy} onClick={start}
        title={mode === 'headphones' ? 'Play original Tidal E-AC-3 JOC through Windows Media Foundation and Windows Spatial Sound (renderer must be enabled).' : 'Play original Tidal E-AC-3 JOC over HDMI with mpv passthrough.'}
        className="rounded-full border border-white/25 bg-black px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50">
        {busy || status?.state === 'loading' ? 'PREPARING ATMOS…' : active ? 'STOP ATMOS' : mode === 'headphones' ? 'PLAY ATMOS · HEADPHONES' : 'PLAY ATMOS · HDMI'}
      </button>
      <button type="button" onClick={openSetup} aria-expanded={setupOpen}
        title="Choose Atmos output: Windows spatial headphones or HDMI receiver"
        className="rounded-full border border-border bg-black px-2 py-0.5 text-[10px] text-white">
        ATMOS SETUP
      </button>
      {error && <span title={error} className="max-w-[18rem] text-[10px] text-red-400">{error}</span>}
      {setupOpen && createPortal((
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/75 p-4" onMouseDown={event => {
          if (event.target === event.currentTarget) setSetupOpen(false)
        }}>
          <div role="dialog" aria-modal="true" aria-label="Dolby Atmos output settings"
            className="flex w-full max-w-md max-h-[85vh] flex-col gap-3 overflow-y-auto rounded-xl border border-white/15 bg-neutral-950 p-5 text-xs text-white shadow-2xl"
            onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Dolby Atmos setup</h2>
              <button type="button" onClick={() => setSetupOpen(false)}
                className="rounded-md border border-white/20 px-3 py-1 text-white/80 hover:text-white" aria-label="Close Dolby Atmos setup">
                Close
              </button>
            </div>
          <span className="font-semibold">Dolby Atmos output</span>
          <label htmlFor={'atmos-mode-' + String(track?.id)}>Output mode</label>
          <select id={'atmos-mode-' + String(track?.id)} value={mode} onChange={event => {
            const selected = event.target.value
            setMode(selected)
            try { localStorage.setItem('lokal-atmos-output-mode', selected) } catch {}
          }} className="rounded border border-white/25 bg-neutral-900 p-2 text-white">
            <option value="headphones">Headphones · Windows Spatial Sound</option>
            <option value="hdmi">HDMI · native bitstream passthrough</option>
          </select>
          {mode === 'headphones' ? (
            <>
              <span className="text-white/65">Uses the default Windows audio output and its Media Foundation decoder. Enable Dolby Atmos for Headphones through Dolby Access and Windows Settings → System → Sound → your headphones → Spatial sound.</span>
              <span>{capability?.headphones?.available ? 'Windows native headphone route available' : 'Windows native headphone route unavailable in this build'}</span>
              <span className="text-white/55">Playback does not prove JOC objects were rendered. If Windows falls back to stereo, Lokal will not claim verified Atmos output.</span>
            </>
          ) : (
            <>
              <span className="text-white/65">Requires mpv and a Dolby Digital Plus Atmos-capable HDMI receiver.</span>
              <span>{capability?.mpvAvailable ? 'mpv detected' : 'mpv not detected'}</span>
              <span className="flex flex-wrap gap-2">
                <button type="button" onClick={chooseMpv}
                  className="rounded border border-white/30 px-2 py-1">Locate mpv executable…</button>
                <a href="https://mpv.io/installation/" target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()} className="px-2 py-1 underline">Install mpv</a>
              </span>
            </>
          )}
          {mode === 'hdmi' && capability?.mpvAvailable && (
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
            </>
          )}
          {(mode === 'headphones' ? capability?.headphones?.available : capability?.mpvAvailable) && (
            <button type="button" onClick={openFile} disabled={busy}
              className="self-start rounded border border-violet-400/40 px-2 py-1 text-violet-200 disabled:opacity-50">
              Open local Atmos file…
            </button>
          )}
          </div>
        </div>
      ), document.body)}
    </span>
  )
}
