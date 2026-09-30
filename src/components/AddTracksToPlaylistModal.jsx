import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, Check, Music, Plus, RefreshCw, Search } from 'lucide-react'
import Modal from './Modal'
import FadeImg from './FadeImg'
import { api } from '../api'
import { peekCache, writeCache } from '../pageCache'

// The library, kept between openings: the list is there at once next time
// (and still refreshed quietly).
const LIBRARY_KEY = 'add-songs:library'
const SKELETON_ROWS = 7

export default function AddTracksToPlaylistModal({ open, onClose, playlistId, existingTrackIds = [], onAdded }) {
  const [tracks, setTracks] = useState(() => peekCache(LIBRARY_KEY) || [])
  const [loaded, setLoaded] = useState(() => !!peekCache(LIBRARY_KEY))
  // The rows (with their artwork) mount once the window has finished opening,
  // so they don't stutter its animation; placeholders hold their place.
  const [entered, setEntered] = useState(false)
  const [query, setQuery] = useState('')
  const [addingId, setAddingId] = useState(null)
  const [added, setAdded] = useState(() => new Set())
  const [error, setError] = useState('')
  // The library couldn't be read (shown only when nothing is cached).
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  // The songs already in the playlist when it opened. One added now stays in
  // its place, marked Added, instead of vanishing and shifting every row
  // under it.
  const [hidden, setHidden] = useState(() => new Set())

  useEffect(() => {
    if (!open) { setEntered(false); return }
    setQuery('')
    setAdded(new Set())
    setError('')
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    setLoadError('')
    let alive = true
    Promise.resolve(api.getTracks({ limit: 5000 })).then(result => {
      if (!alive) return
      if (!Array.isArray(result)) throw new Error(result?.error || 'Could not read your library.')
      writeCache(LIBRARY_KEY, result)
      setTracks(result)
      setLoaded(true)
    }).catch(e => {
      if (!alive) return
      // With a cached library the list stays usable; without one, say so.
      if (peekCache(LIBRARY_KEY)) setLoaded(true)
      else setLoadError(e?.message || 'Could not read your library.')
    })
    return () => { alive = false }
  }, [open, attempt])

  // The playlist can change while this is open (a song added elsewhere):
  // follow it, so no row adds a song twice. Songs added here stay listed,
  // marked Added.
  useEffect(() => {
    if (!open) return
    setHidden(current => {
      const next = new Set(existingTrackIds)
      for (const trackId of added) next.delete(trackId)
      if (next.size === current.size && [...next].every(trackId => current.has(trackId))) return current
      return next
    })
  }, [open, existingTrackIds, added])

  const filteredTracks = useMemo(() => {
    const available = tracks.filter(track => !hidden.has(track.id))
    if (!query.trim()) return available.slice(0, 80)
    const lower = query.trim().toLowerCase()
    return available.filter(track =>
      (track.title || '').toLowerCase().includes(lower) ||
      (track.artist || '').toLowerCase().includes(lower) ||
      (track.album || '').toLowerCase().includes(lower)
    ).slice(0, 120)
  }, [tracks, hidden, query])

  const addTrack = async (trackId) => {
    if (!playlistId || addingId || added.has(trackId)) return
    setAddingId(trackId)
    setError('')
    const result = await Promise.resolve(api.addToPlaylist(playlistId, trackId)).catch(e => ({ error: e?.message || 'Could not add it' }))
    setAddingId(null)
    if (result?.error) { setError(result.error); return }
    setAdded(current => new Set(current).add(trackId))
    onAdded?.()
  }

  // The opening spring looks settled well before framer reports its end (its
  // last fraction of a pixel takes ~0.2 s more), so the rows don't wait for
  // that invisible tail.
  useEffect(() => {
    if (!open || entered) return undefined
    const timer = setTimeout(() => setEntered(true), 280)
    return () => clearTimeout(timer)
  }, [open, entered])

  const showRows = loaded && entered

  return (
    <Modal open={open} onClose={onClose} title="Add Songs" width="max-w-2xl" onEntered={() => setEntered(true)}>
      <div className="space-y-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tracks, artists, or albums"
            className="w-full bg-card border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white outline-none focus:border-accent/50"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}

        {/* A fixed height, so the window never resizes as the list loads or filters. */}
        <div className="h-[28rem] max-h-[55vh] overflow-y-auto">
          {loadError && !loaded ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted">
              <AlertCircle size={26} className="text-red-400/80" />
              <p className="max-w-xs text-sm">Couldn't read your library: {loadError}</p>
              <button onClick={() => setAttempt(n => n + 1)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-white transition-colors hover:border-accent/40">
                <RefreshCw size={12} /> Try again
              </button>
            </div>
          ) : !showRows ? (
            <div className="space-y-2" aria-hidden="true">
              {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card/40 px-3 py-2">
                  <div className="h-10 w-10 flex-shrink-0 rounded-lg bg-elevated" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3 rounded bg-elevated" style={{ width: `${55 - (i % 3) * 10}%` }} />
                    <div className="h-2.5 rounded bg-elevated/70" style={{ width: `${35 - (i % 2) * 8}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} className="space-y-2">
              {!filteredTracks.length && (
                <div className="text-center py-10 text-muted">
                  <Music size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{query.trim() ? 'No matching tracks available to add.' : 'Every song in your library is already here.'}</p>
                </div>
              )}
              {filteredTracks.map(track => {
                const done = added.has(track.id)
                return (
                  <div key={track.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/40 px-3 py-2">
                    <div className="w-10 h-10 rounded-lg bg-elevated border border-border overflow-hidden flex items-center justify-center flex-shrink-0">
                      {track.artwork_path ? (
                        <FadeImg src={api.isElectron ? `file://${track.artwork_path}` : api.artworkURL(track.id)} className="w-full h-full object-cover" alt="" loading="lazy" />
                      ) : (
                        <Music size={16} className="text-muted" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">{track.title}</p>
                      <p className="text-xs text-muted truncate">{track.artist}{track.album ? ` · ${track.album}` : ''}</p>
                    </div>
                    <button
                      onClick={() => addTrack(track.id)}
                      disabled={done || addingId === track.id}
                      aria-label={done ? `${track.title} added` : `Add ${track.title}`}
                      className={`flex w-[5.5rem] flex-shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${done ? 'border-green-400/25 bg-green-500/10 text-green-300' : 'border-accent/30 bg-accent/15 text-accent hover:bg-accent/20 disabled:opacity-50'}`}
                    >
                      {done ? <Check size={12} /> : <Plus size={12} />}
                      {done ? 'Added' : addingId === track.id ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                )
              })}
            </motion.div>
          )}
        </div>
      </div>
    </Modal>
  )
}
