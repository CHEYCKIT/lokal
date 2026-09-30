// Download manager, after BitChord's: a ring on the sidebar's Downloads entry
// shows the whole batch's progress and stays until you've seen how it ended.
// The entry opens a panel with every download, where each can be cancelled,
// retried or cleared, and the playlists downloaded so far (to download again
// for what's new, or remove). Downloads start from Search.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, RotateCcw, AlertCircle, Disc3, Library, ChevronDown, Mic2, Trash2, Square, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDownloads, batchOf, isActive, startDownloadSync } from '../store/downloads'
import { useSearchStore } from '../store/search'
import { api } from '../api'
import { peekCache, writeCache } from '../pageCache'
import { displayTitle } from '../downloadLinks'
import { plural } from '../plural'

// ------------------------------------------------------------------ ring

export function ProgressRing({ value = 0, size = 18, stroke = 2.25, settled = false, failed = false }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={failed && settled ? 'rgb(248,113,113)' : 'currentColor'}
        strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 300ms ease' }}
      />
    </svg>
  )
}

/** Sits at the end of the sidebar's Download entry; nothing when there's no batch. */
export function DownloadIndicator() {
  const jobs = useDownloads(s => s.jobs)
  const togglePanel = useDownloads(s => s.togglePanel)
  const ref = useRef(null)
  useEffect(() => { startDownloadSync() }, [])
  const { batch, active, failed, progress, settled } = batchOf(jobs)
  if (!batch.length) return null
  const label = settled
    ? failed.length ? `${failed.length} download${failed.length === 1 ? '' : 's'} failed` : 'Downloads finished'
    : `${active.length} download${active.length === 1 ? '' : 's'} in progress`
  return (
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      title={label}
      aria-label={label}
      data-download-indicator
      onClick={(e) => { e.stopPropagation(); togglePanel() }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); togglePanel() } }}
      className={`relative flex h-5 w-5 items-center justify-center rounded-full ${settled && failed.length ? 'text-red-400' : 'text-accent'} hover:bg-white/10`}
    >
      <ProgressRing value={settled ? 100 : progress} settled={settled} failed={failed.length > 0} />
      <span className="absolute inset-0 flex items-center justify-center text-[8.5px] font-bold leading-none">
        {settled ? (failed.length ? '!' : <Check size={9} strokeWidth={3.5} />) : active.length}
      </span>
    </span>
  )
}

// ------------------------------------------------------------------ rows

function statusText(job) {
  switch (job.status) {
    case 'queued': return job.retryAt ? job.message || 'Retrying soon' : job.message && job.message !== 'Queued' ? job.message : 'Queued'
    case 'downloading': return job.message || 'Downloading...'
    case 'done': return job.message || 'Saved'
    case 'error': return job.error || 'Failed'
    case 'cancelled': return 'Cancelled'
    case 'incomplete': return 'Stopped before finishing'
    default: return job.status
  }
}

function Artwork({ job, size = 40 }) {
  const [broken, setBroken] = useState(false)
  const Icon = job.kind === 'playlist' ? Library : Disc3
  if (job.thumbnail && !broken) {
    return (
      <div className="relative flex-shrink-0 overflow-hidden rounded-lg bg-black/30" style={{ width: size, height: size }}>
        <img src={job.thumbnail} alt="" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      </div>
    )
  }
  return (
    <div className="flex flex-shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/25" style={{ width: size, height: size }}>
      <Icon size={size * 0.42} className="text-muted" />
    </div>
  )
}

export function DownloadRow({ job, detailed = false }) {
  const { cancel, retry, remove } = useDownloads.getState()
  const [open, setOpen] = useState(false)
  const active = isActive(job)
  const canRetry = job.status === 'error' || job.status === 'cancelled' || job.status === 'incomplete'
  const files = (job.downloadedTracks || []).filter(t => !/\.webm$/i.test(t))
  const tone = job.status === 'error' ? 'text-red-400' : job.status === 'done' ? 'text-green-400' : job.status === 'cancelled' || job.status === 'incomplete' ? 'text-yellow-300' : 'text-muted'

  return (
    <div className={`group rounded-xl ${detailed ? 'border border-border bg-black/15 p-3' : 'px-2 py-2 hover:bg-white/[0.04]'}`}>
      <div className="flex items-center gap-3">
        <Artwork job={job} size={detailed ? 44 : 38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-white">{job.title}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px]">
            {job.status === 'done' && <Check size={11} className="flex-shrink-0 text-green-400" />}
            {job.status === 'error' && <AlertCircle size={11} className="flex-shrink-0 text-red-400" />}
            <span className={`truncate ${tone}`}>{statusText(job)}</span>
            {job.status === 'downloading' && job.speed ? <span className="flex-shrink-0 text-subtle">· {job.speed}</span> : null}
          </p>
          {job.from ? <p className="mt-0.5 truncate text-[10.5px] uppercase tracking-[0.14em] text-subtle">from {job.from}</p> : null}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {job.status === 'downloading' && <span className="w-9 text-right text-[11px] tabular-nums text-muted">{Math.round(job.progress || 0)}%</span>}
          {job.lyricsCount > 0 && !active && (
            <span title={`Lyrics added to ${job.lyricsCount} file${job.lyricsCount === 1 ? '' : 's'}`} className="text-accent/80"><Mic2 size={12} /></span>
          )}
          {canRetry && (
            <button onClick={() => retry(job.id)} title="Retry" className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-white"><RotateCcw size={13} /></button>
          )}
          {active ? (
            <button onClick={() => cancel(job.id)} title="Cancel" className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-white"><Square size={11} fill="currentColor" /></button>
          ) : (
            <button onClick={() => remove(job.id)} title="Remove from list" className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-white/10 hover:text-white"><X size={13} /></button>
          )}
          {detailed && (files.length > 0 || job.output) && (
            <button onClick={() => setOpen(o => !o)} title="Details" className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-white/10 hover:text-white">
              <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {active && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className={`h-full rounded-full ${job.status === 'queued' ? 'bg-white/25' : 'bg-accent'}`}
            initial={false}
            animate={{ width: job.status === 'queued' ? '100%' : `${Math.max(3, job.progress || 0)}%`, opacity: job.status === 'queued' ? 0.35 : 1 }}
            transition={{ duration: 0.3 }}
          />
        </div>
      )}

      {detailed && open && (
        <div className="mt-3 space-y-2">
          {job.totalTracks ? <p className="text-xs text-muted">{Math.min(job.currentTrack || 0, job.totalTracks)} / {job.totalTracks} tracks</p> : null}
          {files.length > 0 && (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border bg-black/15 p-2">
              {files.map((file, i) => (
                <p key={`${file}-${i}`} className="truncate text-xs text-muted"><span className="mr-1 text-accent/70">{i + 1}.</span>{file}</p>
              ))}
            </div>
          )}
          {job.output && (
            <details>
              <summary className="cursor-pointer text-xs text-muted">Log</summary>
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-black/20 p-2 text-[11px] text-muted">{job.output}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

export function DownloadList({ jobs, detailed = false, empty = null }) {
  if (!jobs.length) return empty
  return (
    <div className={detailed ? 'space-y-2' : 'space-y-0.5'}>
      {jobs.map(job => <DownloadRow key={job.id} job={job} detailed={detailed} />)}
    </div>
  )
}

// ------------------------------------------------------------------ panel

/** The playlists downloaded so far: download again (for what's new) or remove. */
function DownloadedPlaylists() {
  const jobs = useDownloads(s => s.jobs)
  const [list, setList] = useState(() => peekCache('dl:playlists') || [])
  const [loaded, setLoaded] = useState(() => peekCache('dl:playlists') !== undefined)
  const [confirming, setConfirming] = useState(null) // a playlist's id, asked "Remove?"
  const [problem, setProblem] = useState('') // why the last download again / remove failed
  const load = () => Promise.resolve(api.getDownloadedPlaylists())
    .then(response => {
      if (!Array.isArray(response)) return
      writeCache('dl:playlists', response)
      setList(response)
    })
    .catch(() => {})
    .finally(() => setLoaded(true))
  useEffect(() => { load() }, [])

  // Both answer { error } or throw when they fail: say so.
  const attempt = (call) => Promise.resolve().then(call).then(result => result?.error || null, e => e?.message || 'Something went wrong')
  const redownload = async (id) => {
    setProblem('')
    const failed = await attempt(() => api.redownloadPlaylist(id))
    if (failed) setProblem(`Couldn't download it again: ${failed}`)
    useDownloads.getState().load()
    load()
  }
  const remove = async (id) => {
    setConfirming(null)
    setProblem('')
    setList(current => current.filter(playlist => playlist.id !== id))
    const failed = await attempt(() => api.deleteDownloadedPlaylist(id))
    // Reloading brings it back when it wasn't removed.
    if (failed) setProblem(`Couldn't remove it: ${failed}`)
    load()
  }
  const problemLine = problem ? <p role="alert" className="px-2 pb-1 text-[11px] text-red-400">{problem}</p> : null

  if (!list.length) {
    return <>{problemLine}<p className="px-3 py-8 text-center text-xs text-muted">{loaded ? 'No playlists downloaded yet. Search for one, or paste its link.' : 'Loading…'}</p></>
  }
  return (
    <div className="space-y-0.5">
      {problemLine}
      {list.map(playlist => {
        const downloading = jobs.some(job => isActive(job) && job.kind === 'playlist' && (job.playlistId === playlist.id || (playlist.url && job.url === playlist.url)))
        const title = displayTitle(playlist, 'Playlist')
        return (
          <div key={playlist.id} className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.04]">
            <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/25">
              <Library size={16} className="text-muted" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-white" title={playlist.url || title}>{title}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted">{plural(playlist.downloaded_count, 'track')}{playlist.status ? ` · ${playlist.status}` : ''}</p>
            </div>
            {confirming === playlist.id ? (
              <div className="flex flex-shrink-0 items-center gap-1">
                <button onClick={() => remove(playlist.id)} className="rounded-lg bg-red-500/15 px-2 py-1 text-[11px] font-semibold text-red-300 transition-colors hover:bg-red-500/25">Remove</button>
                <button onClick={() => setConfirming(null)} className="rounded-lg px-2 py-1 text-[11px] text-muted transition-colors hover:text-white">Keep</button>
              </div>
            ) : (
              <div className="flex flex-shrink-0 items-center gap-1">
                <button onClick={() => redownload(playlist.id)} disabled={downloading}
                  title={downloading ? 'Downloading' : 'Download again (gets what was added since)'}
                  aria-label={`Download ${title} again`}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40">
                  <RotateCcw size={13} className={downloading ? 'animate-spin' : ''} />
                </button>
                <button onClick={() => setConfirming(playlist.id)} title="Remove from this list" aria-label={`Remove ${title}`}
                  className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-white/10 hover:text-red-300">
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// What opens the panel: the ring, and the sidebar's Downloads entry.
const OPENERS = '[data-download-indicator], [data-downloads-toggle]'

export function DownloadManagerPanel() {
  const panelOpen = useDownloads(s => s.panelOpen)
  const jobs = useDownloads(s => s.jobs)
  const { closePanel, cancelAll, clearFinished } = useDownloads.getState()
  const requestFocus = useSearchStore(s => s.requestFocus)
  const nav = useNavigate()
  const [anchor, setAnchor] = useState({ top: 80, left: 232 })
  const [tab, setTab] = useState('queue')
  const panelRef = useRef(null)

  useLayoutEffect(() => {
    if (!panelOpen) return
    const el = document.querySelector('[data-download-indicator]') || document.querySelector('[data-downloads-toggle]')
    const rect = el?.getBoundingClientRect()
    const aside = el?.closest('aside')?.getBoundingClientRect()
    if (rect) setAnchor({ top: Math.max(12, Math.min(rect.top - 12, window.innerHeight - 460)), left: (aside?.right ?? rect.right) + 8 })
  }, [panelOpen])

  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e) => { if (e.key === 'Escape') closePanel() }
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target)) return
      if (e.target.closest?.(OPENERS)) return
      closePanel()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown) }
  }, [panelOpen, closePanel])

  const active = jobs.filter(isActive)
  const finished = jobs.filter(j => !isActive(j))

  const findMore = () => {
    closePanel()
    nav('/search')
    requestFocus()
  }

  return createPortal(
    <AnimatePresence>
      {panelOpen && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label="Downloads"
          initial={{ opacity: 0, x: -6, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -6, scale: 0.98 }}
          transition={{ duration: 0.16 }}
          style={{ top: anchor.top, left: anchor.left, backgroundColor: 'rgba(var(--surface-rgb), 0.97)' }}
          className="fixed z-[80] flex max-h-[440px] w-[340px] flex-col overflow-hidden rounded-2xl border border-border shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl"
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <div role="tablist" aria-label="Downloads" className="flex flex-1 items-center gap-1">
              {[['queue', 'Queue'], ['playlists', 'Playlists']].map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-display uppercase tracking-[0.16em] transition-colors ${tab === id ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white'}`}>
                  {label}{id === 'queue' && active.length ? ` · ${active.length}` : ''}
                </button>
              ))}
            </div>
            {tab === 'queue' && active.length > 0 && (
              <button onClick={cancelAll} className="text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-white">Cancel all</button>
            )}
            {tab === 'queue' && finished.length > 0 && (
              <button onClick={clearFinished} className="flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-white"><Trash2 size={11} />Clear</button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {tab === 'queue'
              ? <DownloadList jobs={jobs} empty={<p className="px-3 py-8 text-center text-xs text-muted">Nothing downloading.</p>} />
              : <DownloadedPlaylists />}
          </div>
          <button
            onClick={findMore}
            className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-left text-[11px] uppercase tracking-[0.18em] text-accent transition-colors hover:bg-white/[0.04]"
          >
            <Search size={12} /> Find music to download
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
