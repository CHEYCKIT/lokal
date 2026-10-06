// "Refresh" for online album and artist data, which is kept once loaded
// (see cachedOnline in onlineBrowse.js): says when it was loaded, spins
// while loading again.

import React from 'react'
import { RefreshCw } from 'lucide-react'

function age(at) {
  const minutes = Math.round((Date.now() - at) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export default function RefreshButton({ onClick, loading = false, loadedAt = 0, label = 'Refresh', className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={loading ? 'Loading…' : loadedAt ? `Loaded ${age(loadedAt)}. Look it up again online.` : 'Look it up again online'}
      aria-label={label}
      className={`inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-white/80 transition-colors hover:border-accent/40 hover:text-white disabled:opacity-60 ${className}`}
    >
      <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
      {label}
    </button>
  )
}
