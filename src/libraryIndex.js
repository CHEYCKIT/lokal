// What the library has as files, to tell the save buttons of streamed songs
// (Search, Home, the player) that a song is already there: by where it was
// downloaded from (its source, e.g. "yt:<videoId>"), or by artist and title
// ("September (2018 Remaster)" is "September"; a live version isn't). Read
// once, then again whenever the library changes (lokal:refresh).

import { useEffect, useState } from 'react'
import { api } from './api.js'
import { recommendationKey, recommendationTitles, titleKey } from './recommendations.js'

/**
 * The artist as written, its first credited artist (a source's list:
 * "Earth, Wind & Fire, The Emotions" -> "Earth, Wind & Fire"), and the artist
 * before "feat." ("Basia feat. X" -> "Basia").
 */
function artistKeys(artist, artists = []) {
  const names = [artist, artists?.[0], String(artist || '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0]]
  return [...new Set(names.map(name => recommendationKey(typeof name === 'object' ? name?.name : name)).filter(Boolean))]
}

const titleKeys = title => [...new Set(recommendationTitles(title).map(titleKey).filter(Boolean))]

/** The keys a song is known by: "artist\0title" for each spelling of either. */
export function songKeys({ artist, artists, title } = {}) {
  const keys = []
  const names = artistKeys(artist, artists)
  // A video named "Artist - Title": the title alone too.
  const prefix = String(title || '').match(/^(.+?)\s+[-–—]\s+(.+)$/)
  const titles = [title, ...(prefix && names.includes(recommendationKey(prefix[1])) ? [prefix[2]] : [])]
  for (const a of names) for (const t of new Set(titles.flatMap(titleKeys))) keys.push(`${a}\0${t}`)
  return keys
}

/**
 * An index of rows [[artist, title, source_ref, low], ...] (api.libraryKeys):
 * each song key and source, and whether the library's copy is low quality
 * (with several copies, only if all of them are).
 */
export function buildLibraryIndex(rows = []) {
  const songs = new Map()
  const sources = new Map()
  const keep = (map, key, low) => map.set(key, map.has(key) ? map.get(key) && low : low)
  for (const row of Array.isArray(rows) ? rows : []) {
    const [artist, title, sourceRef, low] = Array.isArray(row) ? row : [row?.artist, row?.title, row?.source_ref, row?.low]
    for (const key of songKeys({ artist, title })) keep(songs, key, !!low)
    if (sourceRef) keep(sources, String(sourceRef), !!low)
  }
  return { songs, sources }
}

/**
 * The library's copy of a song: null if it has none, else { low } (true when
 * that copy is low quality). `ref` is the song's { provider, id } source, if
 * known; `sourceRef` another key it may have been downloaded under.
 */
export function libraryCopy(index, { ref, sourceRef, artist, artists, title } = {}) {
  if (!index) return null
  const keys = [ref?.provider && ref?.id != null ? `${ref.provider}:${ref.id}` : null, sourceRef].filter(Boolean)
  for (const key of keys) if (index.sources.has(key)) return { low: index.sources.get(key) }
  let found = null
  for (const key of songKeys({ artist, artists, title })) {
    if (!index.songs.has(key)) continue
    const low = index.songs.get(key)
    if (!low) return { low: false }
    found = { low: true }
  }
  return found
}

/** Is the song in the index? */
export function inLibraryIndex(index, song) {
  return !!libraryCopy(index, song)
}

let index = null
let loading = null
let stale = false
const listeners = new Set()

function load() {
  if (loading) { stale = true; return loading }
  loading = Promise.resolve().then(() => api.libraryKeys?.()).then(rows => {
    if (Array.isArray(rows)) index = buildLibraryIndex(rows)
  }).catch(() => {}).finally(() => {
    loading = null
    for (const listener of listeners) listener(index)
    if (stale) { stale = false; load() }
  })
  return loading
}

if (typeof window !== 'undefined') {
  // A download finished, files were added or deleted: read it again (a burst once).
  let timer = null
  window.addEventListener('lokal:refresh', () => { clearTimeout(timer); timer = setTimeout(() => { if (listeners.size) load(); else index = null }, 400) })
}

/** The library index, read on first use and kept up to date (null until read). */
export function useLibraryIndex() {
  const [current, setCurrent] = useState(index)
  useEffect(() => {
    listeners.add(setCurrent)
    if (index) setCurrent(index)
    else load()
    return () => { listeners.delete(setCurrent) }
  }, [])
  return current
}
