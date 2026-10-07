import React, { useEffect, useState } from 'react'
import { playbackSources } from '../recommendations'

/** Manual searches use the same enabled sources as playlist downloads. */
export function useGhostDownloadSources(open) {
  const [sources, setSources] = useState([])
  const [source, setSource] = useState('')
  useEffect(() => {
    if (!open) return
    let current = true
    playbackSources().then(items => {
      if (!current) return
      setSources(items)
      setSource(previous => items.some(item => item.id === previous) ? previous : items[0]?.id || '')
    })
    return () => { current = false }
  }, [open])
  const sourceChoice = (
    <label className="flex items-center gap-2 text-xs text-muted">
      Source
      <select aria-label="Download suggestion source" value={source} onChange={event => setSource(event.target.value)} className="min-w-0 rounded-lg border border-border bg-card px-2 py-1.5 text-white">
        {!sources.length && <option value="">Loading sources…</option>}
        {sources.map(item => <option key={item.id} value={item.id}>{item.id === 'yt' ? 'YouTube' : item.label || item.id}</option>)}
      </select>
    </label>
  )
  return { source, sourceChoice }
}
