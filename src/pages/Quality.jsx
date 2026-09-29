// Audio Quality: what the library is made of (hi-res, lossless, high and low
// bitrate lossy files), lossless files that were made from lossy ones (the
// spectrum check), and a list of what's worth getting again in lossless.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AudioWaveform, Gem, Loader2, Play, RefreshCw, ScanLine, Square } from 'lucide-react'
import { api } from '../api'
import { peekCache, useCachedState, usePageReady, writeCache } from '../pageCache'
import AnimatedNumber from '../components/AnimatedNumber'
import SectionSwap, { ReadyWhen } from '../components/SectionSwap'
import { usePlayerStore } from '../store/player'
import { TIERS, formatLabel, isSuspect, openLossless, tierOf, verdictText } from '../quality'

const FILTERS = [
  ['upgradable', 'Worth upgrading'],
  ['low', 'Low'],
  ['high', 'High'],
  ['suspect', 'Suspect'],
  ['lossless', 'Lossless'],
  ['hires', 'Hi-res'],
]
const PAGE = 200

// Every tile has the same rows, each one line high (badge, number, share,
// description), so the badges, numbers and texts line up across the row.
function StatTile({ tier, count, share, active, onClick, rollFrom }) {
  const info = TIERS[tier]
  return (
    <button onClick={onClick} title={info.hint}
      className={`flex h-full min-w-0 flex-col items-start justify-start gap-1.5 rounded-2xl border p-3 text-left transition-colors ${active ? 'border-accent/50 bg-accent/10' : 'border-border bg-card/50 hover:bg-card'}`}>
      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase leading-4 tracking-wide ${info.className}`}>{info.label}</span>
      <AnimatedNumber value={count} from={rollFrom} className="mt-1 font-display text-2xl leading-8 tabular-nums text-white" />
      <span className="w-full truncate text-[11px] leading-4 text-muted/80 tabular-nums">{share}</span>
      <span className="w-full truncate text-[11px] leading-4 text-muted">{info.desc}</span>
    </button>
  )
}

export default function Quality() {
  // Kept across visits: coming back shows the numbers as they were (and they
  // roll to any new value); the first visit counts them up from zero.
  const [summary, setSummary, summaryWasCached] = useCachedState('quality:summary', null)
  const [job, setJob] = useState({ running: false })
  const [filter, setFilter] = useCachedState('quality:filter', 'upgradable')
  const [rows, setRowsState] = useState(() => peekCache(`quality:rows:${filter}`) || [])
  const [rowsLoaded, setRowsLoaded] = useState(() => !!peekCache(`quality:rows:${filter}`))
  // The filter the rows on screen belong to: a switched-to filter shows (and
  // plays) nothing of another's while its own rows load.
  const [rowsFor, setRowsFor] = useState(() => (peekCache(`quality:rows:${filter}`) ? filter : null))
  const [rowsError, setRowsError] = useState('')
  const [loading, setLoading] = useState(false)
  // Only the latest list request (the filter selected now) is applied.
  const rowsRequestRef = useRef(0)
  usePageReady(!!summary && rowsLoaded)
  const [message, setMessage] = useState('')
  const { playQueue } = usePlayerStore()
  const pollRef = useRef(null)
  const wasRunning = useRef(false)

  // A failed read still lets the page show (with zeros) instead of waiting on it.
  const loadSummary = useCallback(() => Promise.resolve(api.qualitySummary()).then(s => { if (s && !s.error) setSummary(s); else setSummary(prev => prev || {}) }).catch(() => setSummary(prev => prev || {})), [setSummary])
  const loadRows = useCallback(async () => {
    const request = ++rowsRequestRef.current
    // Switching filter shows that filter's last list at once, or none at all
    // (never another filter's rows under this filter's name).
    const seen = peekCache(`quality:rows:${filter}`)
    setRowsState(seen || [])
    setRowsFor(seen ? filter : null)
    setRowsError('')
    setLoading(true)
    const list = await Promise.resolve(api.qualityList({ tier: filter, limit: PAGE })).catch(e => ({ error: e?.message }))
    if (request !== rowsRequestRef.current) return
    if (Array.isArray(list)) {
      writeCache(`quality:rows:${filter}`, list)
      // The quiet refresh of a list already shown usually brings the same
      // rows: re-rendering 200 of them then (mid fade-in) only costs frames.
      if (!(seen && JSON.stringify(seen) === JSON.stringify(list))) setRowsState(list)
      setRowsFor(filter)
    } else {
      // A failed request keeps this filter's cached rows, and says so.
      setRowsError(list?.error || 'Could not load this list')
    }
    setRowsLoaded(true)
    setLoading(false)
  }, [filter])
  // The poll loop outlives filter switches: it reloads the filter shown now.
  const loadRowsRef = useRef(loadRows)
  useLayoutEffect(() => { loadRowsRef.current = loadRows }, [loadRows])

  // Poll the background job (reading details / checking spectra) while it runs.
  const poll = useCallback(async () => {
    clearTimeout(pollRef.current)
    const s = await Promise.resolve(api.qualityStatus()).catch(() => null)
    if (s && !s.error) setJob(s)
    if (s?.running) {
      wasRunning.current = true
      pollRef.current = setTimeout(poll, 1000)
      if (s.done % 25 === 0) loadSummary()
    } else if (wasRunning.current) {
      wasRunning.current = false
      loadSummary()
      loadRowsRef.current()
    }
  }, [loadSummary])

  useEffect(() => { loadSummary(); poll(); return () => clearTimeout(pollRef.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadRows() }, [loadRows])

  // Once the page is up, fetch the other filters' lists in the background
  // (one at a time), so switching filter shows its rows at once.
  const pageUp = !!summary && rowsLoaded
  useEffect(() => {
    if (!pageUp) return
    let cancelled = false
    ;(async () => {
      for (const [tier] of FILTERS) {
        if (cancelled) return
        if (peekCache(`quality:rows:${tier}`)) continue
        await new Promise(r => setTimeout(r, 150))
        if (cancelled) return
        const list = await Promise.resolve(api.qualityList({ tier, limit: PAGE })).catch(() => null)
        if (Array.isArray(list) && !peekCache(`quality:rows:${tier}`)) writeCache(`quality:rows:${tier}`, list)
      }
    })()
    return () => { cancelled = true }
  }, [pageUp])
  useEffect(() => {
    const refresh = () => { loadSummary(); loadRows() }
    window.addEventListener('lokal:quality-changed', refresh)
    window.addEventListener('lokal:refresh', refresh)
    return () => { window.removeEventListener('lokal:quality-changed', refresh); window.removeEventListener('lokal:refresh', refresh) }
  }, [loadSummary, loadRows])

  const start = async (fn) => {
    setMessage('')
    const r = await Promise.resolve(fn()).catch(e => ({ error: e.message }))
    if (r?.error) setMessage(r.error)
    poll()
  }

  const tiers = summary?.tiers || {}
  const total = summary?.total || 0
  const unread = tiers.unknown || 0
  const running = job.running
  const known = total - unread
  const checked = (tiers.hires || 0) + (tiers.lossless || 0) - (summary?.unchecked || 0)
  // Tiers: share of the tracks read. Suspect: out of the lossless files checked.
  const rollFrom = (n) => (summaryWasCached ? n : 0)
  const shareText = (tier) => {
    if (tier === 'suspect') return checked > 0 ? <>of <AnimatedNumber value={checked} from={rollFrom(checked)} /> checked</> : 'Not checked yet'
    if (!known) return '—'
    const pct = Math.round(((tiers[tier] || 0) / known) * 100)
    return <><AnimatedNumber value={pct} from={rollFrom(pct)} />% of tracks</>
  }

  return (
    <div className="max-w-5xl space-y-6 px-4 pb-12 pt-6">
      <section className="rounded-[24px] border border-border bg-card/60 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <AudioWaveform size={18} className="text-accent" />
          <h1 className="font-display text-lg uppercase tracking-[0.28em] text-white">Audio quality</h1>
          <span className="text-xs text-muted tabular-nums"><AnimatedNumber value={total} from={rollFrom(total)} /> tracks</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {running ? (
              <>
                <span className="flex items-center gap-2 text-xs text-muted">
                  <Loader2 size={13} className="animate-spin" />
                  {job.kind === 'check' ? 'Checking spectra' : 'Reading file details'} · {job.done.toLocaleString()} / {job.total.toLocaleString()}
                </span>
                <button onClick={() => start(api.qualityCancel)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:text-white">
                  <Square size={11} /> Stop
                </button>
              </>
            ) : (
              <>
                <button onClick={() => start(() => api.qualityRead({ all: !unread }))}
                  title={unread ? 'Read codec, bitrate, sample rate, bit depth and ISRC of the tracks indexed before Lokal kept them' : 'Read every file again'}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:text-white">
                  <RefreshCw size={12} /> {unread ? `Read details of ${unread.toLocaleString()} tracks` : 'Read all again'}
                </button>
                <button onClick={() => start(() => api.qualityCheck({}))} disabled={!summary?.unchecked}
                  title="Look at the spectrum of lossless files to spot ones made from MP3/AAC (needs ffmpeg, about 1.5 s a file)"
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-[rgb(var(--bg-rgb))] hover:bg-accent/80 disabled:opacity-40">
                  <ScanLine size={12} /> {summary?.unchecked ? `Check ${summary.unchecked.toLocaleString()} lossless files` : 'All lossless files checked'}
                </button>
              </>
            )}
          </div>
        </div>
        {message && <p className="mt-3 rounded-xl border border-red/25 bg-red/10 px-3 py-2 text-xs text-red">{message}</p>}
        {unread > 0 && !running && (
          <p className="mt-3 text-xs text-muted">{unread.toLocaleString()} tracks were added before Lokal kept their format: read their details to see them here.</p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {['hires', 'lossless', 'high', 'low', 'suspect'].map(tier => (
            <StatTile key={tier} tier={tier} count={tiers[tier]} rollFrom={rollFrom(tiers[tier] || 0)} share={shareText(tier)} active={filter === tier} onClick={() => setFilter(tier)} />
          ))}
        </div>
      </section>

      <section className="rounded-[24px] border border-border bg-card/60 p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {FILTERS.map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${filter === id ? 'bg-accent/15 text-accent border border-accent/30' : 'border border-border text-muted hover:text-white'}`}>
              {label}{id === 'upgradable' && tiers.upgradable ? ` · ${tiers.upgradable.toLocaleString()}` : ''}
            </button>
          ))}
          {rows.length > 0 && rowsFor === filter && (
            <button onClick={() => playQueue(rows, 0, { type: 'quality', id: filter, name: `Audio quality: ${FILTERS.find(f => f[0] === filter)?.[1]}` })}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted hover:text-white">
              <Play size={11} fill="currentColor" /> Play these
            </button>
          )}
        </div>
        {/* Switching filter: the new list fades in once its rows are in (not the
            previous filter's rows, then "Loading…", then the new ones). */}
        <SectionSwap id={filter} gated>
        <ReadyWhen ready={rowsFor === filter || !!rowsError} />
        {filter === 'upgradable' && <p className="mb-3 text-xs text-muted">Lossy files, and lossless files the spectrum check found were made from lossy ones. Lowest quality first.</p>}

        {loading && rowsFor !== filter && <p className="flex items-center gap-2 py-6 text-xs text-muted"><Loader2 size={13} className="animate-spin" /> Loading…</p>}
        {rowsError && (
          <p className="flex items-center gap-2 py-3 text-xs text-red">
            Couldn't load this list ({rowsError}).
            <button onClick={loadRows} className="rounded-full border border-border px-2.5 py-0.5 text-muted hover:text-white">Retry</button>
          </p>
        )}
        {rowsFor === filter && !loading && !rowsError && !rows.length && <p className="py-6 text-center text-xs text-muted">Nothing here.</p>}

        <div className="space-y-0.5">
          {rowsFor === filter && rows.map((track, i) => {
            const tier = isSuspect(track) ? 'suspect' : tierOf(track)
            const info = TIERS[tier]
            const verdict = verdictText(track)
            return (
              <div key={track.id} onDoubleClick={() => playQueue(rows, i, { type: 'quality', id: filter, name: 'Audio quality' })}
                className="group grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-elevated"
                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 48px' }}>
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{track.title}</p>
                  <p className="truncate text-xs text-muted" title={verdict || undefined}>
                    {track.artist}{track.album ? ` · ${track.album}` : ''}
                    {tier === 'suspect' && track.spectral_cutoff ? <span className="text-red/80"> · nothing above {track.spectral_cutoff / 1000} kHz</span> : null}
                  </p>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="hidden text-[11px] text-muted sm:inline">{formatLabel(track)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${info.className}`}>{info.label}</span>
                  <button onClick={() => openLossless(track)} title="Get it in lossless"
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-muted opacity-70 transition-all hover:text-accent group-hover:opacity-100">
                    <Gem size={12} /> Lossless
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        {rowsFor === filter && rows.length === PAGE && <p className="mt-3 text-center text-[11px] text-muted">Showing the first {PAGE}.</p>}
        </SectionSwap>
      </section>
    </div>
  )
}
