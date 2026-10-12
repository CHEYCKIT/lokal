// "AutoMix" (or "Crossfade") while one song is mixing into the next, with
// two rings drifting together, like Apple Music's mark.
import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { usePlayerStore } from '../store/player'

export default function MixingMark({ className = '' }) {
  const mixing = usePlayerStore(state => state.mixing)
  const [, tick] = useState(0)
  // Gone when the transition's time is up, even if nothing else changes.
  useEffect(() => {
    if (!mixing?.until) return undefined
    const timer = setTimeout(() => tick(n => n + 1), Math.max(0, mixing.until - Date.now()) + 50)
    return () => clearTimeout(timer)
  }, [mixing?.until])
  const on = !!mixing && mixing.until > Date.now()
  return (
    <AnimatePresence>
      {on && (
        <motion.span
          key="mixing"
          role="status"
          initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 3 }} transition={{ duration: 0.25 }}
          className={`inline-flex items-center gap-1.5 text-[10px] font-display uppercase tracking-[0.18em] text-accent ${className}`}
        >
          <span className="relative inline-block h-2.5 w-4" aria-hidden="true">
            <span className="mixing-ring mixing-ring-left" />
            <span className="mixing-ring mixing-ring-right" />
          </span>
          {mixing.kind === 'crossfade' ? 'Crossfading' : 'AutoMix'}
        </motion.span>
      )}
    </AnimatePresence>
  )
}
