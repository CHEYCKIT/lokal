// The artists you follow: their releases fill Home → Releases. Unfollowing
// an artist also keeps them out of Discovery (stored as the hidden list it
// replaced). A new artist in the library isn't followed until you say so;
// on the first run, everyone already in the library who wasn't hidden is
// followed, so nothing changes for an existing library.
import { create } from 'zustand'
import { api } from './api'

export const discoveryArtistKey = name => String(name || '').normalize('NFKC').trim().toLowerCase()
export function parseHiddenArtists(value) {
  try {
    const names = JSON.parse(value || '[]')
    return new Set(Array.isArray(names) ? names.map(discoveryArtistKey).filter(Boolean) : [])
  } catch { return new Set() }
}

/** The followed artists stored as names: key -> display name. */
export function parseFollowedArtists(value) {
  try {
    const names = JSON.parse(value || '[]')
    return new Map((Array.isArray(names) ? names : []).map(name => [discoveryArtistKey(name), String(name || '').trim()]).filter(([key]) => key))
  } catch { return new Map() }
}

export const useDiscoveryArtists = create(() => ({ hidden: new Set(), followed: new Map(), followReady: false, loaded: false }))
let pending = null
let writes = Promise.resolve()

export function loadDiscoveryArtists() {
  if (!pending) pending = api.getSettings().then(settings => {
    if (settings?.error) throw new Error(settings.error)
    useDiscoveryArtists.setState({
      hidden: parseHiddenArtists(settings.discovery_hidden_artists),
      followed: parseFollowedArtists(settings.followed_artists),
      followReady: settings.followed_artists_ready === '1',
      loaded: true,
    })
  }).finally(() => { pending = null })
  return pending
}

/** Changes the lists one write at a time; the store only changes once saved. */
function update(change) {
  const write = writes.catch(() => {}).then(async () => {
    await loadDiscoveryArtists()
    const state = useDiscoveryArtists.getState()
    const hidden = new Set(state.hidden)
    const followed = new Map(state.followed)
    const extra = change({ hidden, followed }) || {}
    const values = { discovery_hidden_artists: JSON.stringify([...hidden]), followed_artists: JSON.stringify([...followed.values()]), ...extra }
    const result = await api.saveSettings(values)
    if (result?.error) throw new Error(result.error)
    useDiscoveryArtists.setState({ hidden, followed, ...(extra.followed_artists_ready === '1' ? { followReady: true } : {}) })
  })
  writes = write
  return write
}

/** Follow (true) or unfollow (false) artists by name. */
export function setArtistsFollowed(names, follow) {
  const list = (names || []).map(name => [discoveryArtistKey(name), String(name || '').trim()]).filter(([key]) => key)
  if (!list.length) return Promise.resolve()
  return update(({ hidden, followed }) => {
    for (const [key, name] of list) {
      if (follow) { followed.set(key, followed.get(key) || name); hidden.delete(key) }
      else { followed.delete(key); hidden.add(key) }
    }
  })
}

export const setArtistFollowed = (name, follow) => setArtistsFollowed([name], follow)

/** Unfollowing keeps the artist out of Discovery too (the old "Hide from discovery"). */
export const setDiscoveryArtistHidden = (name, hidden) => setArtistFollowed(name, !hidden)

/**
 * Once: follow everyone already in the library who wasn't hidden. Call it
 * with the library's artists once they've loaded.
 */
export async function initFollowedArtists(libraryArtists) {
  await loadDiscoveryArtists()
  if (useDiscoveryArtists.getState().followReady) return
  await update(({ hidden, followed }) => {
    for (const artist of libraryArtists || []) {
      const key = discoveryArtistKey(artist?.name)
      if (key && !hidden.has(key) && !followed.has(key)) followed.set(key, String(artist.name).trim())
    }
    return { followed_artists_ready: '1' }
  })
}

export const isArtistFollowed = (state, name) => state.followed.has(discoveryArtistKey(name))
