// New releases from the artists in the library (electron/ipc/releaseFeed.js).
// Which roles show, and which artists are hidden, are remembered on this computer.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from './api.js'

export const RELEASE_ROLE_MODES = [
  ['main', 'Main artist'],
  ['supporting', 'Supporting'],
  ['both', 'Main + supporting'],
]

const BATCH = 5

export const releaseKey = name => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')

export const useReleaseFeedPrefs = create(persist(set => ({
  mode: 'main',
  hidden: [],
  setMode: mode => set({ mode }),
  hideArtist: name => set(state => ({ hidden: [...new Set([...state.hidden, releaseKey(name)])] })),
  showArtist: name => set(state => ({ hidden: state.hidden.filter(key => key !== releaseKey(name)) })),
}), { name: 'lokal-release-feed' }))

// Shared across tab switches so returning to the tab doesn't refetch everything.
export const useReleaseFeed = create(() => ({
  loading: false,
  done: 0,
  total: 0,
  artists: [],
  error: '',
}))

let running = null

/** Fetch releases for the library's artist names, one batch at a time. */
export function loadReleaseFeed(names) {
  if (running) return running
  const unique = [...new Set(names.map(name => String(name || '').trim()).filter(Boolean))]
  useReleaseFeed.setState({ loading: true, done: 0, total: unique.length, artists: [], error: '' })
  running = (async () => {
    const artists = []
    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = await api.fetchReleaseFeed(unique.slice(i, i + BATCH)).catch(() => [])
      artists.push(...(Array.isArray(batch) ? batch : []))
      useReleaseFeed.setState({ artists: [...artists], done: Math.min(unique.length, i + BATCH) })
    }
    const failed = artists.filter(artist => artist.error).length
    useReleaseFeed.setState({ loading: false, error: failed && failed === artists.length ? 'Could not reach MusicBrainz. Try again later.' : '' })
  })().finally(() => { running = null })
  return running
}

/** The releases to show: hidden artists dropped, roles filtered, newest first. */
export function visibleReleases(artists, { mode, hidden }) {
  const hiddenKeys = new Set(hidden)
  const roles = mode === 'both' ? ['main', 'supporting'] : [mode]
  return artists
    .filter(artist => !hiddenKeys.has(releaseKey(artist.name)))
    .flatMap(artist => (artist.releases || []).filter(release => roles.includes(release.role)).map(release => ({ ...release, artistName: artist.name })))
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
}
