// Soulseek tab of the Downloader: search through slskd, results grouped by the
// uploader's folder (usually an album), best quality first. Picks go into the
// same download queue as everything else.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Download, CheckCircle, Clock, RefreshCw, Folder, User, Zap, AlertTriangle } from 'lucide-react'
import { api } from '../api'
import { useDownloads, isActive } from '../store/downloads'

const fmtSize = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`)
const fmtTime = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '')
const fmtSpeed = (bps) => (bps > 1024 * 1024 ? `${(bps / 1024 / 1024).toFixed(1)} MB/s` : `${Math.round((bps || 0) / 1024)} KB/s`)
const jobUrl = (f) => `soulseek://${encodeURIComponent(f.username)}/${encodeURIComponent(f.filename)}`

function groupResults(results, losslessOnly) {
  const groups = new Map()
  for (const file of results) {
    if (losslessOnly && !file.lossless) continue
    const key = `${file.username}\u0000${file.directory}`
    if (!groups.has(key)) groups.set(key, { key, username: file.username, folder: file.folder || file.directory || '(root)', freeSlot: file.freeSlot, uploadSpeed: file.uploadSpeed, queueLength: file.queueLength, files: [], best: 0 })
    const g = groups.get(key)
    g.files.push(file)
    g.best = Math.max(g.best, file.score)
  }
  return [...groups.values()]
    .map(g => ({ ...g, files: g.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }))
    .sort((a, b) => b.best - a.best)
    .slice(0, 60)
}

export default function SoulseekSearch({ onQueued }) {
  const nav = useNavigate()
  const jobs = useDownloads(s => s.jobs)
  const load = useDownloads(s => s.load)
  const [status, setStatus] = useState(null)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState(null) // { id, complete, results, error }
  const [losslessOnly, setLosslessOnly] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef(null)

  useEffect(() => {
    api.soulseekStatus().then(setStatus).catch(e => setStatus({ error: e.message }))
    return () => { clearTimeout(pollRef.current) }
  }, [])

  const run = async () => {
    const text = query.trim()
    if (!text) return
    clearTimeout(pollRef.current)
    if (search?.id && !search.complete) api.soulseekStopSearch(search.id)
    setError('')
    const started = await api.soulseekSearch(text)
    if (started?.error || !started?.id) { setError(started?.error || 'slskd did not start the search.'); setSearch(null); return }
    setSearch({ id: started.id, complete: false, results: [] })
    const poll = async () => {
      const r = await api.soulseekResults(started.id)
      if (r?.error) { setError(r.error); setSearch(s => (s?.id === started.id ? { ...s, complete: true } : s)); return }
      setSearch(s => (s?.id === started.id ? { ...s, ...r } : s))
      if (!r.complete) pollRef.current = setTimeout(poll, 1000)
    }
    pollRef.current = setTimeout(poll, 700)
  }

  const queue = async (files, folder) => {
    for (const file of files) {
      const result = await api.soulseekDownload(file, folder ? { from: `Soulseek · ${file.username} · ${folder}` } : {})
      if (result?.error) { setError(result.error); break }
    }
    load()
    onQueued?.()
  }

  const groups = useMemo(() => groupResults(search?.results || [], losslessOnly), [search?.results, losslessOnly])
  const stateOf = (file) => {
    const job = jobs.find(j => j.url === jobUrl(file))
    return job ? (isActive(job) ? 'active' : job.status) : null
  }
  const notReady = status?.error || (status && !status.loggedIn)

  return (
    <section className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
      <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted">
        <Search size={14} />
        <span>Soulseek</span>
        {status?.loggedIn && <span className="normal-case tracking-normal text-green-400/80">· connected{status.username ? ` as ${status.username}` : ''}</span>}
      </div>

      {notReady && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-yellow-300" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-yellow-100">{status.error || 'slskd is running but not logged in to Soulseek.'}</p>
            <p className="mt-1 text-xs text-muted">Lokal downloads from Soulseek through slskd. Set its address and API key in Settings → Soulseek.</p>
          </div>
          <button onClick={() => nav('/settings')} className="flex-shrink-0 rounded-xl bg-yellow-500/20 px-3 py-1.5 text-xs font-semibold text-yellow-100 hover:bg-yellow-500/30">Settings</button>
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="Artist and album or song..."
            className="w-full rounded-2xl border border-border bg-black/20 py-3 pl-10 pr-4 text-sm text-white outline-none transition-colors focus:border-accent/50 placeholder:text-muted"
          />
        </div>
        <button onClick={run} disabled={!query.trim()} className="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-[rgb(var(--bg-rgb))] transition-colors hover:bg-accent/80 disabled:opacity-40">
          Search
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs text-muted">
        <button onClick={() => setLosslessOnly(v => !v)} className={`rounded-full px-3 py-1 font-semibold transition-colors ${losslessOnly ? 'bg-accent/15 text-accent border border-accent/30' : 'border border-border hover:text-white'}`}>
          Lossless only
        </button>
        {search && !search.complete && <span className="flex items-center gap-1.5"><RefreshCw size={12} className="animate-spin" /> Searching... {search.results?.length || 0} files so far</span>}
        {search?.complete && <span>{search.results?.length || 0} audio files from {search.responseCount ?? '?'} users</span>}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4 space-y-3">
        {groups.map(group => {
          const queueable = group.files.filter(f => !stateOf(f))
          return (
            <div key={group.key} className="rounded-2xl border border-border bg-black/15">
              <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
                <Folder size={15} className="flex-shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{group.folder}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
                    <span className="flex items-center gap-1"><User size={10} />{group.username}</span>
                    <span className={group.freeSlot ? 'text-green-400/90' : ''}>{group.freeSlot ? 'Free slot' : `Queue ${group.queueLength}`}</span>
                    <span className="flex items-center gap-1"><Zap size={10} />{fmtSpeed(group.uploadSpeed)}</span>
                  </p>
                </div>
                {group.files.length > 1 && (
                  <button
                    onClick={() => queue(queueable, group.folder)}
                    disabled={!queueable.length}
                    className="flex flex-shrink-0 items-center gap-1.5 rounded-xl bg-accent/15 px-3 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
                  >
                    <Download size={12} /> {queueable.length ? `All ${group.files.length}` : 'Queued'}
                  </button>
                )}
              </div>
              <div className="divide-y divide-border/40">
                {group.files.map(file => {
                  const state = stateOf(file)
                  return (
                    <div key={file.key} className="flex items-center gap-3 px-4 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-white">{file.name}</p>
                        <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                          <span className={`rounded px-1.5 py-px font-semibold ${file.lossless ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/60'}`}>{file.quality}</span>
                          <span>{fmtSize(file.size)}</span>
                          {file.length ? <span>{fmtTime(file.length)}</span> : null}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          if (!state) queue([file])
                          else if (state === 'error' || state === 'cancelled') {
                            const job = jobs.find(j => j.url === jobUrl(file))
                            if (job) useDownloads.getState().retry(job.id)
                          }
                        }}
                        disabled={!!state && state !== 'error' && state !== 'cancelled'}
                        className={`flex flex-shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${state === 'done' ? 'text-green-400' : state === 'active' ? 'text-muted' : 'bg-accent/15 text-accent hover:bg-accent/25'}`}
                      >
                        {state === 'done' ? <CheckCircle size={13} /> : state === 'active' ? <Clock size={13} /> : state === 'error' || state === 'cancelled' ? 'Retry' : <><Download size={12} />Get</>}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {search?.complete && !groups.length && !error && (
          <p className="py-8 text-center text-sm text-muted">{losslessOnly && search.results?.length ? 'No lossless files. Turn off "Lossless only".' : 'Nothing found. Try fewer words.'}</p>
        )}
      </div>
    </section>
  )
}
