// Soulseek, as a source in the Search page's online results: searches slskd
// for what's typed in the search box (once typing settles), results grouped
// by the uploader's folder (usually an album), best quality first. Picks go
// into the same download queue as everything else.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, CheckCircle, Clock, RefreshCw, Folder, User, Zap, AlertTriangle } from 'lucide-react'
import { api } from '../api'
import { useDownloads, isActive } from '../store/downloads'
import { peekCache, writeCache } from '../pageCache'

const fmtSize = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`)
const fmtTime = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '')
const fmtSpeed = (bps) => (bps > 1024 * 1024 ? `${(bps / 1024 / 1024).toFixed(1)} MB/s` : `${Math.round((bps || 0) / 1024)} KB/s`)
// A Soulseek search asks the whole network: only once typing has settled.
const SETTLE_MS = 900
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

/**
 * @param query                what to search for (the search box's text)
 * @param initialLosslessOnly  start with "Lossless only" on
 * @param replaceTrack         { replaceTrackId, title, artist }: a streamed song the first single
 *                             file picked here replaces once it's downloaded
 * @param upgradeTrack         { upgradeTrackId, title, artist, current }: a library track whose
 *                             file the first single file picked here replaces once downloaded
 */
export default function SoulseekSearch({ query = '', onQueued, initialLosslessOnly = false, replaceTrack = null, upgradeTrack = null }) {
  const nav = useNavigate()
  const jobs = useDownloads(s => s.jobs)
  const load = useDownloads(s => s.load)
  // The last known connection status shows at once.
  const [status, setStatusState] = useState(() => peekCache('soulseek:status') ?? null)
  const setStatus = (value) => { writeCache('soulseek:status', value); setStatusState(value) }
  const [replacing, setReplacing] = useState(replaceTrack)
  const [upgrading, setUpgrading] = useState(upgradeTrack)
  const [search, setSearch] = useState(null) // { id, complete, results, error }
  const [losslessOnly, setLosslessOnly] = useState(!!initialLosslessOnly)
  const [error, setError] = useState('')
  const pollRef = useRef(null)
  const finishing = useRef(false)
  const showNow = () => {
    if (!search?.id || search.complete || finishing.current) return
    finishing.current = true
    setSearch(s => ({ ...s, finishing: true }))
    api.soulseekFinishSearch(search.id)
  }

  useEffect(() => {
    api.soulseekStatus().then(setStatus).catch(e => setStatus({ error: e.message }))
  }, [])

  // The search running on slskd, stopped when another starts or this goes away.
  const runningRef = useRef(null)
  const stopRunning = () => {
    clearTimeout(pollRef.current)
    if (runningRef.current) api.soulseekStopSearch(runningRef.current)
    runningRef.current = null
  }
  useEffect(() => stopRunning, [])

  // Follows the search box: a new search once the text has settled.
  const text = String(query || '').trim()
  useEffect(() => {
    if (text.length < 2) { stopRunning(); setSearch(null); setError(''); return undefined }
    const t = setTimeout(() => run(text), SETTLE_MS)
    return () => clearTimeout(t)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  const latestText = useRef(text)
  useEffect(() => { latestText.current = text }, [text])
  const run = async (text) => {
    stopRunning()
    setError('')
    setSearch({ id: null, complete: false, results: [], fileCount: 0, responseCount: 0 })
    const started = await api.soulseekSearch(text)
    // Typing went on while slskd was starting it: this one is already stale.
    if (latestText.current !== text) { if (started?.id) api.soulseekStopSearch(started.id); return }
    if (started?.error || !started?.id) { setError(started?.error || 'slskd did not start the search.'); setSearch(null); return }
    runningRef.current = started.id
    finishing.current = false
    setSearch({ id: started.id, complete: false, results: [], fileCount: 0, responseCount: 0 })
    const startedAt = Date.now()
    const poll = async () => {
      const r = await api.soulseekResults(started.id)
      // slskd ends a search 15 s after the last reply; never wait forever.
      // (Ending it rather than deleting it: slskd then hands over its results.)
      if (r && !r.error && !r.complete && Date.now() - startedAt > 60000 && !finishing.current) { finishing.current = true; api.soulseekFinishSearch(started.id) }
      if (runningRef.current !== started.id) return
      if (r?.error) { setError(r.error); runningRef.current = null; setSearch(s => (s?.id === started.id ? { ...s, complete: true } : s)); return }
      setSearch(s => (s?.id === started.id ? { ...s, ...r } : s))
      if (!r.complete) pollRef.current = setTimeout(poll, 1000)
      else runningRef.current = null
    }
    pollRef.current = setTimeout(poll, 700)
  }

  const queue = async (files, folder) => {
    // One file picked for a streamed song (it takes the stream's place) or
    // for "Get it in lossless" (it replaces the track's file).
    const replaceTrackId = replacing && files.length === 1 ? replacing.replaceTrackId : undefined
    const upgradeTrackId = upgrading && files.length === 1 ? upgrading.upgradeTrackId : undefined
    for (const file of files) {
      const opts = folder ? { from: `Soulseek · ${file.username} · ${folder}` } : {}
      if (replaceTrackId) opts.replaceTrackId = replaceTrackId
      if (upgradeTrackId) opts.upgradeTrackId = upgradeTrackId
      const result = await api.soulseekDownload(file, opts)
      if (result?.error) { setError(result.error); break }
    }
    if (replaceTrackId) setReplacing(null)
    if (upgradeTrackId) setUpgrading(null)
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
    <div>
      {replacing && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-accent/25 bg-accent/10 px-4 py-3 text-sm">
          <Download size={15} className="flex-shrink-0 text-accent" />
          <p className="min-w-0 flex-1 text-text">
            Pick a file for <span className="font-semibold">{[replacing.artist, replacing.title].filter(Boolean).join(' – ')}</span>. Once it's downloaded it replaces the streamed version in your playlists.
          </p>
          <button onClick={() => setReplacing(null)} className="flex-shrink-0 text-xs text-muted hover:text-text">Cancel</button>
        </div>
      )}

      {upgrading && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-accent/25 bg-accent/10 px-4 py-3 text-sm">
          <Download size={15} className="flex-shrink-0 text-accent" />
          <p className="min-w-0 flex-1 text-text">
            Pick one file for <span className="font-semibold">{[upgrading.artist, upgrading.title].filter(Boolean).join(' – ')}</span>{upgrading.current ? <span className="text-muted"> (now {upgrading.current})</span> : null}.
            Once it's downloaded it replaces that file in your library, keeping its playlists, likes and plays; the old file is moved to Lokal's data folder.
          </p>
          <button onClick={() => setUpgrading(null)} className="flex-shrink-0 text-xs text-muted hover:text-text">Cancel</button>
        </div>
      )}

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

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <button onClick={() => setLosslessOnly(v => !v)} className={`rounded-full px-3 py-1 font-semibold transition-colors ${losslessOnly ? 'bg-accent/15 text-accent border border-accent/30' : 'border border-border hover:text-white'}`}>
          Lossless only
        </button>
        {search && !search.complete && (
          <>
            <span className="flex items-center gap-1.5">
              <RefreshCw size={12} className="animate-spin" />
              {search.finishing
                ? 'Collecting results...'
                : search.responseCount
                  ? `Searching... ${Number(search.fileCount || 0).toLocaleString()} files from ${search.responseCount} users so far`
                  : 'Searching...'}
            </span>
            {search.responseCount > 0 && !search.finishing && (
              <button onClick={showNow} className="rounded-full border border-border px-3 py-1 font-semibold text-white/80 transition-colors hover:text-white">Show results now</button>
            )}
          </>
        )}
        {search?.complete && <span>{search.results?.length || 0} audio files from {search.responseCount ?? '?'} users</span>}
        {status?.loggedIn && <span className="ml-auto text-green-400/80">Connected{status.username ? ` as ${status.username}` : ''}</span>}
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
    </div>
  )
}
