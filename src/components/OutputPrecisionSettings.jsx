import React, { useEffect, useState } from 'react'
import { readOutputPreferences } from '../audio/nativeOutput'

export default function OutputPrecisionSettings({ compact = false }) {
  const [preferences, setPreferences] = useState(readOutputPreferences)
  const [status, setStatus] = useState(() => window.__lokalOutputStatus || { mode: 'auto' })
  const [capabilities, setCapabilities] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    const refresh = () => {
      window.electron?.nativeAudio?.devices().then(value => { if (alive) setCapabilities(value) }).catch(() => {
        if (alive) setCapabilities({ available: false, error: 'Could not list native audio outputs.' })
      })
    }
    const update = event => { setStatus(event.detail); setPreferences(readOutputPreferences()) }
    refresh()
    window.addEventListener('lokal:output-status', update)
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    return () => {
      alive = false
      window.removeEventListener('lokal:output-status', update)
      navigator.mediaDevices?.removeEventListener('devicechange', refresh)
    }
  }, [])

  const choose = async patch => {
    const next = { ...preferences, ...patch }
    setBusy(true)
    try {
      const result = await window.__lokalSetOutputPrecision?.(next)
      setPreferences(next)
      if (result) setStatus(result)
    } catch { setStatus({ mode: 'auto', warning: 'Could not change output precision. Try Auto output.' }) }
    finally { setBusy(false) }
  }
  const desktop = !!window.electron?.nativeAudio
  const native = status.mode === 'native'
  return (
    <div className={compact ? 'space-y-3 p-2' : 'space-y-3 border-b border-border pb-4 mb-4'}>
      <p className="text-xs font-display uppercase tracking-wider text-muted">Output precision</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Output precision">
        {[['auto', 'Auto'], ['pcm16', '16-bit PCM'], ['float32', '32-bit float']].map(([value, label]) => (
          <button type="button" key={value} aria-pressed={preferences.precision === value}
            disabled={busy || (value !== 'auto' && (!desktop || !capabilities?.available))}
            onClick={() => choose({ precision: value })}
            className={`rounded-lg border px-3 py-2 text-sm disabled:opacity-40 ${preferences.precision === value ? 'bg-accent text-base border-accent' : 'bg-card text-text border-border'}`}>
            {label}
          </button>
        ))}
      </div>
      {desktop && preferences.precision !== 'auto' && (
        <label className="block text-xs text-muted">Native output device
          <select aria-label="Native output device" value={preferences.deviceName} disabled={busy}
            onChange={event => choose({ deviceName: event.target.value })}
            className="mt-1 block w-full rounded-lg border border-border bg-card text-text p-2">
            <option value="">System default</option>
            {preferences.deviceName && !capabilities?.devices?.some(device => device.name === preferences.deviceName) && (
              <option value={preferences.deviceName}>{preferences.deviceName} (unavailable)</option>
            )}
            {[...new Set((capabilities?.devices || []).map(device => device.name))].map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      )}
      {desktop && capabilities?.supportsExclusive && (
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={preferences.exclusive} disabled={busy || preferences.precision === 'auto'}
            onChange={event => choose({ exclusive: event.target.checked })} className="accent-accent" />
          Windows exclusive mode
        </label>
      )}
      {desktop && capabilities?.supportsExclusive && !compact && <p className="text-xs text-muted">Exclusive mode bypasses the Windows mixer and may prevent other apps from using this device. If the device is busy or unsupported, Lokal uses shared output.</p>}
      <p className="text-xs text-muted" aria-live="polite">
        {status.mode === 'switching'
          ? 'Switching output…'
          : status.mode === 'idle'
          ? 'Output released · starts with playback'
          : native
          ? `App output: ${status.precision === 'float32' ? '32-bit float' : '16-bit PCM'} · ${status.sampleRate / 1000} kHz · stereo · ${status.exclusive ? 'Exclusive' : 'Shared'}`
          : `Auto output${status.sampleRate ? ` · ${status.sampleRate / 1000} kHz processing` : ' · starts with playback'}`}
      </p>
      {status.warning && <p role="alert" className="text-xs text-amber-400">{status.warning}</p>}
      {!desktop ? <p className="text-xs text-muted">Choose an output precision in the desktop app. Web playback uses the browser’s output.</p>
        : capabilities?.error ? <p className="text-xs text-muted">{capabilities.error}</p> : null}
      {!compact && <p className="text-xs text-muted">Auto uses the system-managed output. Explicit modes keep EQ and crossfade, then send stereo PCM to the selected device. Shared output may be converted by the system mixer. Exclusive mode bypasses that mixer; source decoding, EQ and sample-rate conversion can still change the audio, so it does not guarantee bit-perfect playback. Higher precision does not restore detail missing from a recording.</p>}
    </div>
  )
}
