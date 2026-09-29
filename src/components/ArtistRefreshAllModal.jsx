import React, { useEffect, useRef, useState } from 'react'
import { RefreshCw, Square } from 'lucide-react'
import Modal from './Modal'
import { api, peekSettings } from '../api'

import { ARTIST_SOURCES as SOURCES } from '../artistSources'

const PACE_NOTE = {
  either: 'MusicBrainz allows one request a second, so a large library takes a while.',
  musicbrainz: 'MusicBrainz allows one request a second, so a large library takes a while.',
  theaudiodb: 'TheAudioDB allows about 30 requests a minute, so a large library takes a while.',
}

/**
 * Artists > Refresh artist info: fetches every artist's bio and picture again
 * from the chosen provider (a background job in the main process / server).
 * Stays mounted with the page, so it keeps following a running job after the
 * dialog is closed, and refreshes the page when the job ends.
 */
export default function ArtistRefreshAllModal({ open, onClose, onStatus }) {
  const [source, setSource] = useState(() => peekSettings()?.artist_metadata_source || 'either')
  const [status, setStatus] = useState(null)
  const [starting, setStarting] = useState(false)
  const wasRunning = useRef(false)

  useEffect(() => {
    if (open) setSource(peekSettings()?.artist_metadata_source || 'either')
  }, [open])

  const running = !!status?.running
  useEffect(() => {
    if (!open && !running) return
    let timer = null
    let cancelled = false
    const tick = async () => {
      const next = await Promise.resolve(api.artistsRefreshAllStatus()).catch(() => null)
      if (cancelled) return
      if (next && !next.error) {
        setStatus(next)
        onStatus?.(next)
        if (wasRunning.current && !next.running) window.dispatchEvent(new Event('lokal:refresh'))
        wasRunning.current = !!next.running
      }
      timer = setTimeout(tick, next?.running ? 1000 : 4000)
    }
    tick()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [open, running]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setStarting(true)
    const next = await Promise.resolve(api.artistsRefreshAllMetadata({ source })).catch(() => null)
    setStarting(false)
    if (next && !next.error) {
      setStatus(next)
      onStatus?.(next)
      wasRunning.current = !!next.running
    }
  }

  const cancel = async () => {
    const next = await Promise.resolve(api.artistsRefreshAllCancel()).catch(() => null)
    if (next && !next.error) setStatus(next)
  }

  const percent = status?.total ? Math.round((status.done / status.total) * 100) : 0
  const finished = !!(status && !status.running && status.finishedAt)

  return (
    <Modal open={open} onClose={onClose} title="Refresh artist info" width="max-w-md">
      <div className="space-y-4">
        <p className="text-xs text-muted leading-relaxed">
          Fetches every artist's bio and picture again and replaces the ones fetched online before.
          Anything you set yourself (a picture you picked, a bio you wrote, a Lookup result you applied) is kept.
          {source === 'deezer' && ' Deezer only has pictures, so bios stay as they are.'}
        </p>

        <div className="flex gap-1 p-0.5 bg-card rounded-lg border border-border">
          {SOURCES.map(([id, label]) => (
            <button key={id} onClick={() => setSource(id)} disabled={running}
              className={`flex-1 min-w-0 px-1 py-1.5 !text-[10px] font-display uppercase tracking-wide rounded transition-colors disabled:opacity-50 ${source === id ? 'bg-accent text-base' : 'text-muted hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>

        {status && (status.running || finished) && (
          <div className="space-y-2">
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-[width] duration-500" style={{ width: `${running ? percent : 100}%` }} />
            </div>
            <p className="text-xs text-muted">
              {running
                ? `${status.done.toLocaleString()} of ${status.total.toLocaleString()} artists · ${status.images} pictures and ${status.bios} bios updated`
                : `Done: ${status.images} pictures and ${status.bios} bios updated across ${status.done.toLocaleString()} artists${status.failed ? ` (${status.failed} failed)` : ''}.`}
            </p>
            {running && PACE_NOTE[status.source || source] && (
              <p className="text-[11px] text-muted/70">{PACE_NOTE[status.source || source]} You can close this; it keeps going.</p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Close</button>
          {running ? (
            <button onClick={cancel} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-red-500/30 bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors inline-flex items-center justify-center gap-2">
              <Square size={12} /> Stop
            </button>
          ) : (
            <button onClick={start} disabled={starting} className="flex-1 py-2.5 bg-accent text-base rounded-xl text-sm font-medium hover:bg-accent-dim transition-colors disabled:opacity-40 inline-flex items-center justify-center gap-2">
              <RefreshCw size={13} /> {finished ? 'Run again' : 'Refresh all artists'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
