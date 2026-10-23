import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { showLoadingToast } from './Toaster'
import { usePlayerStore } from '../store/player'

/** Native Atmos session controls. HDMI confirms compressed bitstream output;
 * Windows headphones use Media Foundation and cannot verify JOC rendering. */
export default function AtmosTransport() {
  const [status, setStatus] = useState(null)
  const [paused, setPaused] = useState(false)
  const active = useRef(false)

  useEffect(() => {
    let toast = null
    const off = api.onAtmosStatus(next => {
      active.current = next?.state === 'playing' || next?.state === 'loading'
      setStatus(next)
      if (next?.state === 'loading') {
        if (!toast) toast = showLoadingToast('Preparing Dolby Atmos…')
        const pct = next.percent == null ? NaN : Number(next.percent)
        const measurable = Number.isFinite(pct) && pct >= 0 && pct <= 100
        // The percentage comes from received/total bytes or finished/total
        // segments. Keep the subsequent decoding/output stage indeterminate:
        // 100% downloaded does not imply the native player has started.
        const phase = /segments/i.test(next.message || '')
          ? 'Downloading Dolby Atmos segments'
          : 'Downloading Dolby Atmos'
        toast.update(measurable
          ? `${phase} · ${Math.round(pct)}%`
          : next.message || 'Preparing Dolby Atmos…')
      } else {
        toast?.close()
        toast = null
        if (next?.state === 'playing') setPaused(false)
      }
    })
    return () => { toast?.close(); off?.() }
  }, [])

  useEffect(() => usePlayerStore.subscribe((now, before) => {
    // Starting normal Lokal playback must not mix PCM on top of the
    // exclusive HDMI bitstream session.
    if (active.current &&
      (now.currentTrack?.id !== before.currentTrack?.id ||
       (now.isPlaying && !before.isPlaying))) {
      api.atmosStop().catch(() => {})
    }
  }), [])

  if (!active.current && status?.state !== 'playing' && status?.state !== 'loading') return null
  const command = async text => {
    const result = await api.atmosCommand(text)
    if (result?.ok && text === 'cycle pause') setPaused(v => !v)
  }
  return (
    <div role="region" aria-label="Dolby Atmos native output" className="fixed right-6 bottom-24 z-[100] flex max-w-[22rem] flex-col gap-2 rounded-xl border border-violet-400/25 bg-neutral-950/95 p-3 text-sm text-white shadow-xl">
      <div className="font-semibold">{status?.state === 'playing'
          ? status?.mode === 'headphones' ? 'E-AC-3 JOC · Windows headphone output' : 'E-AC-3 JOC · HDMI bitstream'
          : 'Preparing Dolby Atmos…'}</div>
      <div className="text-xs text-white/65">
        {status?.state === 'playing'
          ? status?.mode === 'headphones'
            ? 'Windows native decoder / spatial processing. Enable Dolby Atmos for Headphones in Windows; object rendering is not independently verified.'
            : 'Native HDMI passthrough. The receiver controls Atmos decoding and volume.'
          : 'Requesting the original Atmos stream.'}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => command('seek -10 relative')} disabled={status?.state !== 'playing'} className="rounded bg-white/10 px-2 py-1 disabled:opacity-40">−10s</button>
        <button onClick={() => command('cycle pause')} disabled={status?.state !== 'playing'} className="rounded bg-white/10 px-2 py-1 disabled:opacity-40">{paused ? 'Resume' : 'Pause'}</button>
        <button onClick={() => command('seek 10 relative')} disabled={status?.state !== 'playing'} className="rounded bg-white/10 px-2 py-1 disabled:opacity-40">+10s</button>
        <button onClick={() => api.atmosStop()} className="rounded bg-red-700/50 px-2 py-1">Stop</button>
      </div>
    </div>
  )
}
