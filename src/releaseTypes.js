// Release types on artist pages: releases are shown in sections (Albums,
// EPs, Singles, Compilations, Live), and which ones show is chosen per
// artist (useReleaseTypes), remembered on this computer.

import { useCallback, useState } from 'react'
import { recommendationKey } from './recommendations.js'

export const RELEASE_TYPES = [
  ['album', 'Albums'],
  ['ep', 'EPs'],
  ['single', 'Singles'],
  ['compilation', 'Compilations'],
  ['live', 'Live'],
  ['unknown', 'Unknown albums'],
]
const KNOWN = new Set(RELEASE_TYPES.map(([type]) => type))

/**
 * Online catalogues don't all use the same release-type field or casing.
 * Normalize their metadata before grouping; the local library's unknown
 * releases remain explicit so they can still be reviewed and classified.
 */
function catalogueReleaseType(release) {
  for (const value of [release?.release_type, release?.releaseType, release?.album_type, release?.albumType, release?.type]) {
    if (typeof value !== 'string') continue
    const type = value.trim().toLocaleLowerCase().replace(/[_-]+/g, ' ')
    if (!type || type === 'unknown' || type === 'unknown album' || type === 'n/a') continue
    if (/\bsingle\b/.test(type)) return 'single'
    if (/\bep\b|extended play/.test(type)) return 'ep'
    if (/compilation|greatest hits|best of/.test(type)) return 'compilation'
    if (/\blive\b/.test(type)) return 'live'
    if (/\balbum\b|\blp\b|long play/.test(type)) return 'album'
  }
  return null
}

function catalogueTrackCount(release) {
  const value = [release?.track_count, release?.trackCount, release?.total_tracks, release?.totalTracks]
    .find(count => count !== null && count !== undefined && count !== '')
  const count = Number(value ?? (Array.isArray(release?.tracks) ? release.tracks.length : 0))
  return Number.isFinite(count) && count > 0 ? count : 0
}

/**
 * Online artist shelves should be split into Albums, EPs and Singles, not
 * strand valid releases under "Unknown albums" simply because a catalogue
 * omitted or differently named its type field. Explicit source metadata wins;
 * complete track counts provide the fallback (1 = single, 2–6 = EP, 7+ = album).
 * Unresolved titled releases default to Albums rather than an Unknown section.
 * Placeholder records are discarded.
 */
export function classifyOnlineReleases(releases = []) {
  return (Array.isArray(releases) ? releases : [])
    .filter(release => {
      const title = String(release?.title || '').trim().toLocaleLowerCase()
      return title && !['unknown', 'unknown album', 'untitled', 'untitled album', 'n/a'].includes(title)
    })
    .map(release => {
      const explicit = catalogueReleaseType(release)
      const count = catalogueTrackCount(release)
      const inferred = count === 1 ? 'single' : count >= 2 && count <= 6 ? 'ep' : count >= 7 ? 'album' : 'album'
      return { ...release, release_type: explicit || inferred }
    })
}

/** Placeholder titles and missing/unrecognized types are grouped as unknown releases. */
export const releaseTypeOf = release => {
  const title = String(release?.title || '').trim().toLocaleLowerCase()
  if (!title || title === 'unknown album') return 'unknown'
  return KNOWN.has(release?.release_type) ? release.release_type : 'unknown'
}

/**
 * Releases in sections, in RELEASE_TYPES order, without empty or hidden ones:
 * [{ type, label, items }].
 */
export function groupReleases(releases = [], shown = null) {
  return RELEASE_TYPES
    .map(([type, label]) => ({ type, label, items: releases.filter(release => releaseTypeOf(release) === type) }))
    .filter(group => group.items.length && (!shown || shown.has(group.type)))
}

/** The types present in `releases`, with counts: [{ type, label, count }]. */
export function releaseTypeCounts(releases = []) {
  return RELEASE_TYPES
    .map(([type, label]) => ({ type, label, count: releases.filter(release => releaseTypeOf(release) === type).length }))
    .filter(entry => entry.count > 0)
}

const STORAGE_KEY = 'lokal-artist-release-types'
function readAll() {
  try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); return value && typeof value === 'object' ? value : {} } catch { return {} }
}

/** The types shown for an artist (all unless chosen), as a Set. */
export function shownReleaseTypes(artistName) {
  const saved = readAll()[recommendationKey(artistName)]
  return new Set(Array.isArray(saved) ? saved.filter(type => KNOWN.has(type)) : RELEASE_TYPES.map(([type]) => type))
}

/** [shown, toggle(type)] for an artist; remembered per artist. */
export function useReleaseTypes(artistName) {
  const [state, setState] = useState(() => ({ name: artistName, shown: shownReleaseTypes(artistName) }))
  const shown = state.name === artistName ? state.shown : shownReleaseTypes(artistName)
  const toggle = useCallback(type => {
    const next = new Set(shown)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    try {
      const all = readAll()
      all[recommendationKey(artistName)] = [...next]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    } catch {}
    setState({ name: artistName, shown: next })
  }, [artistName, shown])
  return [shown, toggle]
}

const ALBUMS_PAGE_KEY = 'lokal-albums-release-types'

/**
 * [shown, toggle(type)] for the Albums page, remembered on this computer.
 * `hideSingles`: the old "Show Singles in Albums" switch was off, so Singles
 * start hidden until a type is chosen here.
 */
export function useAlbumsPageReleaseTypes({ hideSingles = false } = {}) {
  const read = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(ALBUMS_PAGE_KEY) || 'null')
      if (Array.isArray(saved)) return new Set(saved.filter(type => KNOWN.has(type)))
    } catch {}
    return new Set(RELEASE_TYPES.map(([type]) => type).filter(type => !(hideSingles && type === 'single')))
  }
  const [shown, setShown] = useState(read)
  const toggle = useCallback(type => {
    setShown(current => {
      const next = new Set(current)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      try { localStorage.setItem(ALBUMS_PAGE_KEY, JSON.stringify([...next])) } catch {}
      return next
    })
  }, [])
  return [shown, toggle]
}
