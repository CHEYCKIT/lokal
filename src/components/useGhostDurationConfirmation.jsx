import React, { useCallback, useEffect, useRef, useState } from 'react'
import { providerLabel, streamRef } from '../onlineTracks'

const length = value => {
  const seconds = Math.round(Number(value) || 0)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Queue concurrent batch decisions inside the existing ghost resolver. */
export function useGhostDurationConfirmation(open) {
  const active = useRef(open)
  const epoch = useRef(0)
  if (active.current !== open) epoch.current++
  active.current = open
  const generation = epoch.current
  const requests = useRef([])
  const [pending, setPending] = useState(null)
  const settle = useCallback(accepted => {
    requests.current.shift()?.resolve(accepted)
    setPending(requests.current[0] || null)
  }, [])
  useEffect(() => {
    active.current = open
    if (!open) {
      for (const request of requests.current.splice(0)) request.resolve(false)
      setPending(null)
    }
    return () => {
      active.current = false
      for (const request of requests.current.splice(0)) request.resolve(false)
    }
  }, [open])
  const isCurrent = useCallback(() => active.current && epoch.current === generation, [generation])
  const confirmDuration = useCallback((ghost, found) => {
    if (!active.current) return Promise.resolve(false)
    return new Promise(resolve => {
      const request = { ghost, found, resolve }
      requests.current.push(request)
      if (requests.current.length === 1) setPending(request)
    })
  }, [])
  const provider = pending && (pending.found.provider || streamRef(pending.found)?.provider)
  const durationChoice = pending && (
    <div role="region" aria-label="Different song length" className="rounded-xl border border-yellow-400/30 bg-yellow-400/10 p-4 space-y-3">
      <p className="text-sm font-medium text-white">Use a different-length version?</p>
      <p className="text-sm text-white">{pending.ghost.artist} — {pending.ghost.title}</p>
      <p className="text-xs text-muted">Playlist: {length(pending.ghost.duration)} · Found: {length(pending.found.duration)} ({provider ? providerLabel(provider) : pending.found.file_path ? 'Your library' : 'YouTube'})</p>
      <p className="text-xs text-muted">{pending.found.title}{pending.found.album ? ` · ${pending.found.album}` : ''}. This may be a different recording or edit.</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => settle(true)} className="px-3 py-2 rounded-lg bg-accent text-base text-xs">Use this version</button>
        <button type="button" onClick={() => settle(false)} className="px-3 py-2 rounded-lg bg-card text-white text-xs">Skip</button>
      </div>
    </div>
  )
  return { confirmDuration, durationChoice, isCurrent }
}
