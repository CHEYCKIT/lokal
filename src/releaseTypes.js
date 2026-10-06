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
]
const KNOWN = new Set(RELEASE_TYPES.map(([type]) => type))

/** A release's type: one of RELEASE_TYPES ("album" when unknown). */
export const releaseTypeOf = release => (KNOWN.has(release?.release_type) ? release.release_type : 'album')

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
