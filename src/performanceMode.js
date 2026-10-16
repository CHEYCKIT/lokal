import { useSyncExternalStore } from 'react'
import { api } from './api'

let performanceMode = false
let initialized = false
let revision = 0
const listeners = new Set()

function setSettings(settings) {
  const next = settings?.performanceMode === true
  if (next === performanceMode) return
  performanceMode = next
  for (const listener of listeners) listener()
}

function initialize() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  // Subscribe before reading: an update arriving while the snapshot is being
  // fetched must take precedence over that potentially stale response.
  api.onPerfSettings(settings => {
    revision++
    setSettings(settings)
  })
  const startRevision = revision
  Promise.resolve(api.getPerfSettings())
    .then(settings => { if (revision === startRevision) setSettings(settings) })
    .catch(() => {})
}

function subscribe(listener) {
  initialize()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return performanceMode
}

export function usePerformanceMode() {
  initialize()
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
