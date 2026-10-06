// Songs whose moving cover (a Spotify Canvas or an animated album cover) is
// turned off, from the side panel's button: the still cover shows instead,
// in the side panel and the full screen player. Kept by artist and title, so
// it follows the song whether it's streamed or a file; remembered on this
// computer.

import { useEffect, useState } from 'react'
import { songKey } from './recommendations.js'

const STORAGE_KEY = 'lokal-motion-cover-off'
const EVENT = 'lokal:motion-cover-pref'

function readAll() {
  try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return new Set(Array.isArray(value) ? value : []) } catch { return new Set() }
}

const keyOf = track => (track?.title ? songKey(track) : null)

/** Is the moving cover turned off for this song? */
export function isMotionCoverOff(track) {
  const key = keyOf(track)
  return !!key && readAll().has(key)
}

/** Turn the song's moving cover off (true) or back on (false). */
export function setMotionCoverOff(track, off) {
  const key = keyOf(track)
  if (!key) return
  const all = readAll()
  if (off) all.add(key)
  else all.delete(key)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...all])) } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, off } }))
}

/** [off, setOff(boolean)] for a song, kept in step across the views showing it. */
export function useMotionCoverOff(track) {
  const key = keyOf(track)
  const [off, setOff] = useState(() => isMotionCoverOff(track))
  useEffect(() => {
    setOff(isMotionCoverOff(track))
    const onChange = event => { if (event.detail?.key === key) setOff(!!event.detail.off) }
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return [off, value => setMotionCoverOff(track, value)]
}
