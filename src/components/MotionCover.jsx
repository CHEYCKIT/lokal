// A moving cover over the still artwork, Apple Music style: a muted, looping
// clip that fades in once its first frame is ready. The still cover stays
// underneath the whole time, so a missing or failing clip just means the
// usual artwork. Clips are looked up (and cached) by the main process; the
// lookup is remembered per track here too, so reopening a view is instant.

import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'

const lookups = new Map() // trackId -> Promise<{ src, source } | null>

export function loadMotionCover(trackId) {
  if (!trackId || !api.motionCover) return Promise.resolve(null)
  if (!lookups.has(trackId)) {
    if (lookups.size > 200) lookups.delete(lookups.keys().next().value)
    lookups.set(trackId, Promise.resolve(api.motionCover(trackId)).catch(() => null))
  }
  return lookups.get(trackId)
}

/** Settings changed (moving covers turned on/off, sources): look again. */
export function forgetMotionCovers() {
  lookups.clear()
}

if (typeof window !== 'undefined') window.addEventListener('lokal:settings-saved', forgetMotionCovers)

/**
 * Renders only the clip layer; put it over the still <img>.
 * @param only      'square' (album-style clips, for the cover spot) or 'tall'
 *                  (9:16 canvases, for a full-panel background); both if unset
 * @param onActive  called with true while a clip is showing
 */
export default function MotionCover({ trackId, className = '', onActive, only, style }) {
  const [clip, setClip] = useState(null)
  const [ready, setReady] = useState(false)
  const videoRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setClip(null)
    setReady(false)
    onActive?.(false)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (!trackId || reduced) return undefined
    loadMotionCover(trackId).then(found => {
      if (cancelled || !found?.src) return
      if (only === 'square' && found.tall) return
      if (only === 'tall' && !found.tall) return
      setClip(found)
    })
    return () => { cancelled = true }
  }, [trackId, only]) // eslint-disable-line react-hooks/exhaustive-deps

  // Unmounting (e.g. the next track has no artwork, so the parent stops
  // rendering this) must also clear the parent's "clip showing" state -- the
  // track-change reset above never runs then. Latest callback via a ref, and
  // an empty dependency list, so this fires on unmount only.
  const onActiveRef = useRef(onActive)
  onActiveRef.current = onActive
  useEffect(() => () => { onActiveRef.current?.(false) }, [])

  // Don't spend the GPU on a clip nobody can see.
  useEffect(() => {
    const onVisibility = () => {
      const v = videoRef.current
      if (!v) return
      if (document.hidden) v.pause()
      else v.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  if (!clip) return null
  return (
    <video
      ref={videoRef}
      key={clip.src}
      src={clip.src}
      muted
      loop
      autoPlay
      playsInline
      preload="auto"
      disablePictureInPicture
      onPlaying={() => { if (!ready) { setReady(true); onActive?.(true) } }}
      onError={() => { setClip(null); onActive?.(false) }}
      className={`absolute inset-0 h-full w-full object-cover ${className}`}
      style={{ ...style, opacity: ready ? 1 : 0, transition: 'opacity 320ms ease' }}
      title={{ apple: 'Moving cover from Apple Music', tidal: 'Moving cover from Tidal', spotify: 'Spotify Canvas' }[clip.source] || 'Moving cover'}
    />
  )
}
