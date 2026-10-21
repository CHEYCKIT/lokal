// Release types on artist pages: releases are shown in sections (Albums,
// EPs, Singles, Compilations, Live and Features), and which ones show is chosen
// per artist (useReleaseTypes), remembered on this computer.

import { useCallback, useState } from 'react'
import { recommendationKey } from './recommendations.js'

export const RELEASE_TYPES = [
  ['album', 'Albums'],
  ['ep', 'EPs'],
  ['single', 'Singles'],
  ['compilation', 'Compilations'],
  ['live', 'Live'],
  ['feature', 'Features'],
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
    if (/\bfeature(?:d|s)?\b|\bfeaturing\b|\bappears? on\b|\bguest appearance\b/.test(type)) return 'feature'
    if (/\bsingle\b/.test(type)) return 'single'
    if (/\bep\b|extended play/.test(type)) return 'ep'
    if (/compilation|greatest hits|best of/.test(type)) return 'compilation'
    if (/\blive\b/.test(type)) return 'live'
    if (/\balbum\b|\blp\b|long play/.test(type)) return 'album'
  }
  return null
}

const falseLike = value => value === false || value === 0 || (typeof value === 'string' && /^(false|0|no|off)$/i.test(value.trim()))
const trueLike = value => value === true || value === 1 || (typeof value === 'string' && /^(true|1|yes|on)$/i.test(value.trim()))

/** True when the catalogue identifies this as a featured/secondary-artist release. */
function isFeatureRelease(release) {
  for (const key of ['is_main_artist', 'isMainArtist', 'main_artist', 'mainArtist', 'is_primary_artist', 'isPrimaryArtist', 'album_is_main_artist', 'albumIsMainArtist']) {
    if (falseLike(release?.[key])) return true
  }
  for (const key of ['is_featured', 'isFeatured', 'featured', 'is_feature', 'isFeature']) {
    if (trueLike(release?.[key])) return true
  }
  for (const value of [release?.release_type, release?.releaseType, release?.album_type, release?.albumType, release?.type, release?.release_role, release?.releaseRole, release?.artist_role, release?.artistRole, release?.role]) {
    if (typeof value !== 'string') continue
    const type = value.trim().toLocaleLowerCase().replace(/[_-]+/g, ' ')
    if (/\bfeature(?:d|s)?\b|\bfeaturing\b|\bappears? on\b|\bguest appearance\b/.test(type)) return true
  }
  return false
}

function catalogueTrackCount(release) {
  const value = [release?.track_count, release?.trackCount, release?.total_tracks, release?.totalTracks]
    .find(count => Number.isFinite(Number(count)) && Number(count) > 0)
  if (value !== undefined) return Number(value)
  return Array.isArray(release?.tracks) ? release.tracks.length : 0
}

/**
 * Online artist shelves should be split into release types, not strand valid
 * releases under "Unknown albums" simply because a catalogue omitted or
 * differently named its type field. Feature credits take precedence over the
 * release's format; otherwise explicit metadata wins, then track counts provide
 * the fallback (1 = single, 2–6 = EP, 7+ = album). Unresolved titled releases
 * default to Albums. Placeholder records are discarded.
 */
export function classifyOnlineReleases(releases = []) {
  return (Array.isArray(releases) ? releases : [])
    .filter(release => {
      const title = String(release?.title || '').trim().toLocaleLowerCase()
      return title && !['unknown', 'unknown album', 'untitled', 'untitled album', 'n/a'].includes(title)
    })
    .map(release => {
      const explicit = isFeatureRelease(release) ? 'feature' : catalogueReleaseType(release)
      const count = catalogueTrackCount(release)
      const inferred = count === 1 ? 'single' : count >= 2 && count <= 6 ? 'ep' : 'album'
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
const FEATURE_FILTER_MIGRATION_KEY = 'lokal-artist-release-types-features-v1'
function readAll() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const all = value && typeof value === 'object' ? value : {}
    // Features are new to the filter. Include them in each saved artist choice
    // once, so existing preferences don't accidentally hide the new section.
    if (localStorage.getItem(FEATURE_FILTER_MIGRATION_KEY) !== '1') {
      for (const [artist, types] of Object.entries(all)) {
        if (Array.isArray(types) && !types.includes('feature')) all[artist] = [...types, 'feature']
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
      localStorage.setItem(FEATURE_FILTER_MIGRATION_KEY, '1')
    }
    return all
  } catch { return {} }
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
