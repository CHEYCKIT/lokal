// "On YouTube Music": songs that aren't in the library, under the local
// results on the Search page. They stream with the user's yt-dlp; + adds one
// to a playlist and ⬇ saves it to the library (both keep it as a ghost track
// until the file is in). Off with Settings → Library → Online Results in Search.

import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, Music, Pause, Play, Plus } from 'lucide-react'
import { api } from '../api'
import { usePlayerStore, useAppStore } from '../store/player'
import { streamVideoId, saveToLibrary } from '../onlineTracks'
import { saveRecentSearch } from '../searchHistory'

const DEBOUNCE_MS = 450

function fmtDuration(seconds) {
  const s = Math.round(Number(seconds) || 0)
  if (!s) return ''
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Is online search switched on in Settings (default: on)? */
function useOnlineSearchEnabled() {
  const [enabled, setEnabled] = useState(true)
  useEffect(() => {
    const load = () => Promise.resolve(api.getSettings?.()).then(s => setEnabled(s?.online_search !== '0')).catch(() => {})
    load()
    window.addEventListener('lokal:settings-saved', load)
    return () => window.removeEventListener('lokal:settings-saved', load)
  }, [])
  return enabled
}

/** Online songs for `query`, with play / add to playlist / save to library. */
export default function OnlineResults({ query }) {
  const enabled = useOnlineSearchEnabled()
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(() => new Set())
  const seqRef = useRef(0)
  const { currentTrack, isPlaying, playQueue, togglePlay } = usePlayerStore()
  const { openAddToPlaylist } = useAppStore()
  const q = String(query || '').trim()

  useEffect(() => {
    const seq = ++seqRef.current
    if (!enabled || q.length < 2) { setResults([]); setLoading(false); setError(null); return undefined }
    setLoading(true)
    const t = setTimeout(async () => {
      let res
      try { res = await api.onlineSearch(q) } catch (e) { res = { error: e.message } }
      if (seq !== seqRef.current) return
      setResults(Array.isArray(res?.results) ? res.results : [])
      setError(res?.results?.length ? null : res?.error || null)
      setLoading(false)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q, enabled])

  if (!enabled || q.length < 2) return null
  if (!loading && !results.length && !error) return null

  /** Keep the results as ghost tracks (so they can be queued, liked, added). */
  const asTracks = async () => {
    const rows = await api.onlineSave(results)
    return Array.isArray(rows) ? rows : []
  }

  const play = async (item, index) => {
    if (currentTrack && streamVideoId(currentTrack) === item.videoId) { togglePlay(); return }
    saveRecentSearch(q)
    const rows = await asTracks()
    const target = rows[index]
    if (!target) return
    const queue = rows.filter(Boolean)
    playQueue(queue, queue.findIndex(t => t.id === target.id), { type: 'search', id: q, name: `YouTube Music: ${q}` })
  }

  const addToPlaylist = async (item) => {
    const [row] = await api.onlineSave([item])
    if (row?.id) openAddToPlaylist(row)
  }

  const save = async (item) => {
    setSaving(prev => new Set(prev).add(item.videoId))
    const [row] = await api.onlineSave([item])
    const result = row ? await saveToLibrary(row).catch(e => ({ error: e.message })) : { error: 'Could not save' }
    if (result?.error) setSaving(prev => { const next = new Set(prev); next.delete(item.videoId); return next })
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-display text-muted uppercase tracking-widest flex items-center gap-2">
          On YouTube Music
          {loading && <span className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />}
        </h2>
        <span className="text-[10px] text-muted/80">Streams with yt-dlp · not in your library</span>
      </div>
      {error && !results.length && <p className="text-xs text-muted py-2">{error}</p>}
      <div className="space-y-0.5">
        {results.map((item, i) => {
          const current = currentTrack && streamVideoId(currentTrack) === item.videoId
          const isSaving = saving.has(item.videoId)
          return (
            <motion.div
              key={item.videoId}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 10) * 0.02 }}
              onDoubleClick={() => play(item, i)}
              className={`group grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 px-3 py-1.5 rounded-lg transition-colors ${current ? 'bg-accent/10' : 'hover:bg-elevated'}`}
            >
              <button
                onClick={() => play(item, i)}
                title={current && isPlaying ? 'Pause' : 'Play'}
                aria-label={`${current && isPlaying ? 'Pause' : 'Play'} ${item.title}`}
                className="relative w-10 h-10 rounded overflow-hidden bg-card flex items-center justify-center text-muted"
              >
                {item.thumbnail ? <img src={item.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <Music size={14} />}
                <span className={`absolute inset-0 flex items-center justify-center bg-black/50 text-white transition-opacity ${current ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  {current && isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="translate-x-px" />}
                </span>
              </button>
              <div className="min-w-0">
                <p className={`text-sm font-medium truncate ${current ? 'text-accent' : 'text-text'}`}>{item.title}</p>
                <p className="text-xs text-muted truncate">
                  {[item.artist, item.album].filter(Boolean).join(' · ')}
                  {item.kind === 'video' && <span className="ml-1.5 text-[10px] uppercase tracking-wide opacity-70">Video</span>}
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <button onClick={() => addToPlaylist(item)} title="Add to playlist" aria-label={`Add ${item.title} to a playlist`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted hover:text-accent transition-all">
                  <Plus size={15} />
                </button>
                <button onClick={() => save(item)} disabled={isSaving} title={isSaving ? 'Saving to your library…' : 'Save to library'} aria-label={`Save ${item.title} to your library`}
                  className={`transition-all ${isSaving ? 'text-accent' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted hover:text-accent'}`}>
                  <Download size={15} />
                </button>
                <span className="text-xs text-muted font-display w-10 text-right">{fmtDuration(item.duration)}</span>
              </div>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
