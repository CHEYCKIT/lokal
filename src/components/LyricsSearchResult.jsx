import React from 'react'
import { motion } from 'framer-motion'
import { Play } from 'lucide-react'

/** The library lyrics-search result, shared with online lyric records. */
export default function LyricsSearchResult({ title, artist, album, snippet, onPlay, disabled = false, index = 0, playLabel = 'Play' }) {
  return <motion.button
    initial={{ opacity: 0, y: 4 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: Math.min(index, 10) * 0.02 }}
    onClick={onPlay}
    disabled={disabled}
    className="w-full text-left rounded-xl border border-border bg-elevated/70 hover:border-accent/30 hover:bg-card transition-colors px-4 py-3 disabled:opacity-50"
  >
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-white truncate">{title}</p>
        <p className="text-xs text-muted truncate">{artist}{album ? ` · ${album}` : ''}</p>
      </div>
      <div className="flex items-center gap-2 text-accent flex-shrink-0">
        <span className="text-[10px] font-display uppercase tracking-[0.22em]">{playLabel}</span>
        <Play size={13} fill="currentColor" />
      </div>
    </div>
    {snippet && <p className="text-xs text-muted mt-2 truncate">{snippet}</p>}
  </motion.button>
}
