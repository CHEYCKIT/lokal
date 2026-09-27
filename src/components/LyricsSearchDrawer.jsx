// Manual lyrics search (LRCLIB), shared by the lyrics fullscreen view and the
// sidebar lyrics panel. The search can be kept by the parent (`session` +
// `onSessionChange`, so results survive closing the drawer) or left to the
// drawer itself.
//
// variant="side": a 20rem drawer from the right edge (fullscreen views)
// variant="fill": covers the whole panel (the narrow sidebar)

import React, { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Search } from 'lucide-react'

function formatDuration(d) {
  if (!d) return '--:--'
  return Math.floor(d / 60) + ':' + String(Math.floor(d % 60)).padStart(2, '0')
}

export default function LyricsSearchDrawer({ track, session: outerSession, onSessionChange: outerChange, onClose, onSelect, variant = 'side' }) {
  const [innerSession, setInnerSession] = useState(() => ({ title: track?.title || '', artist: track?.artist || '', results: [], loading: false, error: null }))
  const session = outerSession || innerSession
  const onSessionChange = outerChange || ((patch) => setInnerSession(s => ({ ...s, ...patch })))

  const title = session?.title ?? track?.title ?? ''
  const artist = session?.artist ?? track?.artist ?? ''
  const results = session?.results || []
  const loading = session?.loading || false
  const error = session?.error || null

  // Only the newest search may fill the list, and only while the fields
  // still say what it searched for: an older, slower answer is dropped.
  const requestSeq = useRef(0)
  const latest = useRef({ title, artist })
  latest.current = { title, artist }

  const handleSearch = async () => {
    if (!title || !artist || loading) return
    const seq = ++requestSeq.current
    const query = { title, artist }
    const stillCurrent = () => seq === requestSeq.current && latest.current.title === query.title && latest.current.artist === query.artist
    onSessionChange({ loading: true, error: null, results: [] })
    try {
      const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(query.title)}&artist_name=${encodeURIComponent(query.artist)}`
      const res = await fetch(url)
      const data = await res.json()
      if (stillCurrent()) onSessionChange({ results: Array.isArray(data) ? data : [], loading: false, searched: true })
      else if (seq === requestSeq.current) onSessionChange({ loading: false })
    } catch (e) {
      if (seq === requestSeq.current) onSessionChange({ error: stillCurrent() ? e.message : null, loading: false })
    }
  }

  const handleResultClick = (result) => {
    const lyrics = result.syncedLyrics || result.plainLyrics
    if (!lyrics) return
    onSelect(lyrics, result.syncedLyrics ? 'lrc' : 'txt')
  }

  const fill = variant === 'fill'
  return (
    <motion.div
      initial={fill ? { opacity: 0, y: 12 } : { x: 320 }}
      animate={fill ? { opacity: 1, y: 0 } : { x: 0 }}
      exit={fill ? { opacity: 0, y: 12 } : { x: 320 }}
      transition={fill ? { duration: 0.18 } : { type: 'spring', stiffness: 300, damping: 30 }}
      className={fill
        ? 'absolute inset-0 z-40 flex flex-col bg-black/90 backdrop-blur-xl'
        : 'absolute top-0 right-0 h-full w-80 bg-black/95 backdrop-blur-xl border-l border-white/10 z-20 flex flex-col'}
    >
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <button onClick={onClose} className="p-1 text-white/40 hover:text-white transition-colors" title="Close">
          <X size={18} />
        </button>
        <h3 className="text-sm font-medium text-white">Search Lyrics</h3>
        <div className="w-5" />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); handleSearch() }}
        className="p-4 space-y-3 border-b border-white/10"
      >
        <div>
          <label className="text-xs text-white/40 uppercase tracking-wider">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => onSessionChange({ title: e.target.value })}
            placeholder="Track title"
            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
          />
        </div>
        <div>
          <label className="text-xs text-white/40 uppercase tracking-wider">Artist</label>
          <input
            type="text"
            value={artist}
            onChange={(e) => onSessionChange({ artist: e.target.value })}
            placeholder="Artist name"
            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
          />
        </div>
        <button
          type="submit"
          disabled={!title || !artist || loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent text-base rounded-lg text-sm font-medium hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Searching...' : <><Search size={14} /> Search</>}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </form>

      <div className="flex-1 overflow-y-auto p-2">
        {results.length === 0 && !loading && !error && (
          <p className="text-xs text-white/30 text-center py-8">
            {session?.searched ? 'Nothing found. Try a shorter title.' : 'Enter title and artist to search'}
          </p>
        )}
        {results.map((r, i) => (
          <button
            key={r.id ?? i}
            onClick={() => handleResultClick(r)}
            className="w-full p-3 text-left hover:bg-white/5 rounded-lg transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{r.trackName}</p>
                <p className="text-xs text-white/50 truncate">{r.artistName}</p>
                {r.albumName && <p className="text-xs text-white/30 truncate">{r.albumName}</p>}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-white/40">{formatDuration(r.duration)}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${r.syncedLyrics ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'}`}>
                  {r.syncedLyrics ? 'Synced' : 'Unsynced'}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  )
}
