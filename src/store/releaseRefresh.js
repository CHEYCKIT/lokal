// The catalogue refresh belongs to the app, not the Albums route. Leaving the
// page only removes its UI; the request and its progress keep going.
import { create } from 'zustand'
import { api } from '../api.js'
import { resolveLibraryReleaseTypes } from '../albumReleaseTypes.js'

let job = null

export const useReleaseRefresh = create(() => ({
  running: false,
  done: 0,
  total: 0,
  matched: 0,
  failed: 0,
  current: '',
  error: '',
  finishedAt: 0,
}))

export function startReleaseRefresh(albums, client = api) {
  if (job) return job
  useReleaseRefresh.setState({ running: true, done: 0, total: 0, matched: 0, failed: 0, current: '', error: '', finishedAt: 0 })
  job = Promise.resolve()
    .then(() => resolveLibraryReleaseTypes(albums, client, {
      refresh: true,
      onProgress: progress => useReleaseRefresh.setState(progress),
    }))
    .catch(error => useReleaseRefresh.setState({ error: error.message || 'Could not refresh releases.' }))
    .finally(() => {
      job = null
      useReleaseRefresh.setState({ running: false, finishedAt: Date.now() })
    })
  return job
}
