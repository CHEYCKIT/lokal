// Page polish: pages keep what they last showed, and only fade in once they
// have something real to show.
//
// Every page fetches its data when it mounts, so it used to paint its empty
// state first ("No tracks yet", "Folder not set", "Loading artists..."), then
// swap in the data a few frames later. Two small tools fix that:
//
//   useCachedState  a useState that remembers its value across visits, so
//                   coming back to a page paints the last data on frame one
//                   (and the page still refetches it quietly).
//   usePageReady    tells the route transition the page has its data; the
//                   page stays invisible until then (or PAGE_READY_TIMEOUT_MS,
//                   so a slow load never hides a page for long).

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react'

const cache = new Map()

/** The value a page last stored under `key`, or undefined. */
export function peekCache(key) {
  return cache.get(key)
}

/** Store a value for the next visit of a page. */
export function writeCache(key, value) {
  cache.set(key, value)
}

/**
 * useState whose value outlives the page: the next mount starts from the
 * last value instead of `initial`. `key` should include whatever the data
 * depends on (e.g. the user id), and must not change while the component is
 * mounted: give the component a React `key` that changes with it instead,
 * so it remounts (see Home and Recap). Returns [value, setValue, wasCached].
 */
export function useCachedState(key, initial) {
  const wasCached = useRef(cache.has(key)).current
  const [value, setValue] = useState(() => (cache.has(key) ? cache.get(key) : (typeof initial === 'function' ? initial() : initial)))
  const keyRef = useRef(key)
  keyRef.current = key
  const set = useCallback((next) => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next
      cache.set(keyRef.current, resolved)
      return resolved
    })
  }, [])
  return [value, set, wasCached]
}

// How long a page may stay hidden waiting for its data before it's shown anyway.
export const PAGE_READY_TIMEOUT_MS = 350

export const PageReadyContext = createContext(null)

/**
 * Hold the page's fade-in until `ready` is true. Layout effect, so a page
 * whose data is already cached is released before its first paint.
 */
export function usePageReady(ready) {
  const markReady = useContext(PageReadyContext)
  useLayoutEffect(() => {
    if (ready) markReady?.()
  }, [ready, markReady])
}
