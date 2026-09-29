// The download queue as the UI sees it. The queue itself lives in the main
// process (electron/download/manager.js) and survives restarts; this mirrors
// it: progress events on desktop, polling in web mode (and as a safety net).

import { create } from 'zustand'
import { api } from '../api'

export const ACTIVE_STATUSES = new Set(['queued', 'downloading'])
export const isActive = (job) => ACTIVE_STATUSES.has(job?.status)

const RANK = { downloading: 0, queued: 1 }

function sortJobs(jobs) {
  return jobs.slice().sort((a, b) =>
    (RANK[a.status] ?? 2) - (RANK[b.status] ?? 2) ||
    ((b.finishedAt || b.createdAt || 0) - (a.finishedAt || a.createdAt || 0)))
}

// A download that adds songs to the library (desktop and web alike): the
// pages showing the library reload, once, shortly after.
let refreshTimer = null
function refreshLibrarySoon() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => window.dispatchEvent(new Event('lokal:refresh')), 600)
}

/** Did any job add songs to the library since `before`? */
function addedSongs(before, after, knownSince) {
  const prev = new Map(before.map(j => [j.id, j]))
  return after.some(job => {
    const count = job.indexedTracks?.length || 0
    if (!count) return false
    const old = prev.get(job.id)
    // A job first seen already finished (web polling can miss the middle):
    // it counts if it finished after the queue was first loaded.
    if (!old) return knownSince != null && (job.finishedAt || 0) > knownSince
    return count > (old.indexedTracks?.length || 0)
  })
}

let loadedAt = null

function merge(jobs, incoming) {
  const map = new Map(jobs.map(j => [j.id, j]))
  for (const job of incoming) {
    if (!job?.id) continue
    map.set(job.id, { ...(map.get(job.id) || {}), ...job })
  }
  return sortJobs([...map.values()])
}

export const useDownloads = create((set, get) => ({
  jobs: [],
  loaded: false,
  panelOpen: false,

  load: async () => {
    try {
      const queue = await api.getDownloadQueue()
      if (!Array.isArray(queue)) return
      const before = get().jobs
      set({ jobs: sortJobs(queue), loaded: true })
      if (loadedAt == null) loadedAt = Date.now()
      else if (addedSongs(before, queue, loadedAt)) refreshLibrarySoon()
    } catch {}
  },

  upsert: (job) => {
    const before = get().jobs
    set(state => ({ jobs: merge(state.jobs, [job]) }))
    if (loadedAt != null && addedSongs(before, [job], loadedAt)) refreshLibrarySoon()
  },

  /** @returns the server's answer ({ downloadId } or { error }) */
  enqueue: async (kind, url, opts = {}) => {
    const call = kind === 'playlist' ? api.downloadPlaylist : api.downloadYT
    const result = await call(url, opts)
    await get().load()
    return result
  },

  cancel: async (id) => {
    set(state => ({ jobs: state.jobs.map(j => j.id === id ? { ...j, message: 'Stopping...' } : j) }))
    await api.cancelDownload(id)
    await get().load()
  },

  retry: async (id) => {
    const result = await api.retryDownload(id)
    await get().load()
    return result
  },

  remove: async (id) => {
    set(state => ({ jobs: state.jobs.filter(j => j.id !== id) }))
    await api.removeDownload(id)
  },

  cancelAll: async () => {
    await api.cancelAllDownloads()
    await get().load()
  },

  clearFinished: async () => {
    set(state => ({ jobs: state.jobs.filter(isActive) }))
    await api.clearFinishedDownloads()
  },

  markSeen: async () => {
    if (!get().jobs.some(j => !isActive(j) && !j.seen)) return
    set(state => ({ jobs: state.jobs.map(j => isActive(j) ? j : { ...j, seen: true }) }))
    await api.markDownloadsSeen()
  },

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => { set({ panelOpen: false }); get().markSeen() },
  togglePanel: () => (get().panelOpen ? get().closePanel() : set({ panelOpen: true })),
}))

/**
 * The batch the sidebar indicator describes: everything still going, plus what
 * finished since the user last looked. A failed download counts as settled.
 */
export function batchOf(jobs) {
  const batch = jobs.filter(j => isActive(j) || !j.seen)
  const active = batch.filter(isActive)
  const failed = batch.filter(j => j.status === 'error')
  const progress = batch.length
    ? batch.reduce((sum, j) => sum + (isActive(j) ? (j.progress || 0) : 100), 0) / batch.length
    : 0
  return { batch, active, failed, progress, settled: batch.length > 0 && active.length === 0 }
}

let started = false
/** Starts mirroring the queue once for the whole app. */
export function startDownloadSync() {
  if (started) return
  started = true
  try { localStorage.removeItem('lokal-downloads') } catch {}
  const { load, upsert } = useDownloads.getState()
  load()
  api.onDownloadProgress((_, data) => { if (data?.id) upsert(data) })
  const tick = () => {
    const busy = useDownloads.getState().jobs.some(isActive)
    if (!api.isElectron || busy || useDownloads.getState().panelOpen) load()
    setTimeout(tick, api.isElectron ? (busy ? 4000 : 15000) : (busy ? 1500 : 6000))
  }
  setTimeout(tick, 2000)
}
