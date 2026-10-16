// The cover changing from one song to the next, for the side panel and the
// full-screen player. Each song's cover is a layer (its artwork, and its
// moving cover or Canvas when it has one), the new one over the old:
//
//   AutoMix  the way iOS 27's AutoMix does it: the next song's cover grows
//            in through soft, cloudy blobs, blurred at first and sharpening,
//            while the old one stays put underneath (MIX_MS).
//   else     a short crossfade (FADE_MS).
//
// The blobs are a CSS mask (radial gradients, redrawn every frame), so it
// works the same on artwork, moving covers and Canvas clips.
//
// A transition that can't run (the window minimized: no animation frames)
// still finishes on a timer, so the new cover is always the one left showing.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { usePlayerStore } from '../store/player'
import { isWindowHidden, onWindowVisibility } from '../windowVisibility'
import { usePerformanceMode } from '../performanceMode'
import { blobBlur, blobMask, clamp01, coverTransitionMode, makeBlobs } from '../coverMix'

const MIX_MS = 2400
const FADE_MS = 300

let nextKey = 0

function Layer({ layer, children, onDone }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (layer.mode === 'base') {
      // Settled (maybe on the timer, before the last frame): nothing of the transition left on it.
      for (const name of ['maskImage', 'webkitMaskImage', 'filter', 'opacity']) el.style[name] = ''
      return undefined
    }
    const duration = layer.mode === 'mix' ? MIX_MS : FADE_MS
    let started = performance.now()
    let hidden = isWindowHidden()
    let frame = 0
    let timer = null
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      if (timer !== null) clearTimeout(timer)
      timer = null
      onDone()
    }
    const paint = now => {
      frame = 0
      if (hidden || finished) return
      const p = clamp01((now - started) / duration)
      if (layer.mode === 'mix') {
        const mask = blobMask(layer.blobs, p)
        el.style.webkitMaskImage = mask
        el.style.maskImage = mask
        const blur = blobBlur(p)
        el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : ''
      } else {
        el.style.opacity = String(p)
      }
      if (p < 1) frame = requestAnimationFrame(paint)
      else finish()
    }
    const unsubscribeVisibility = onWindowVisibility(nextHidden => {
      hidden = nextHidden
      // There's no value in animating a hidden cover; settle to the new layer.
      if (hidden) finish()
      else { started = performance.now(); paint(started) }
    })
    if (hidden) finish()
    else {
      paint(started)
      timer = setTimeout(finish, duration + 60)
    }
    return () => {
      unsubscribeVisibility()
      if (frame) cancelAnimationFrame(frame)
      if (timer !== null) clearTimeout(timer)
    }
    // The layer's own transition: the song's details updating (new artwork) don't restart it.
  }, [layer.key, layer.mode]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} className="absolute inset-0" style={layer.mode === 'fade' ? { opacity: 0 } : layer.mode === 'mix' ? { WebkitMaskImage: blobMask(layer.blobs, 0), maskImage: blobMask(layer.blobs, 0) } : undefined}>{children}</div>
}

/**
 * @param track the song playing; `render(track, { top })` its cover's content
 *   (absolutely filling the layer); `top` is false for one on its way out.
 */
export default function MixCovers({ track, render }) {
  const reduceMotion = useReducedMotion()
  const performanceMode = usePerformanceMode()
  const id = track?.id ?? null
  const [layers, setLayers] = useState(() => [{ key: ++nextKey, id, track, mode: 'base' }])
  const shown = layers[layers.length - 1]

  useEffect(() => {
    if (performanceMode) {
      setLayers(list => {
        const top = list[list.length - 1]
        if (list.length === 1 && top.mode === 'base' && top.id === id && top.track === track) return list
        return [{ ...top, id, track, mode: 'base', blobs: null }]
      })
      return
    }
    if (id === shown.id) {
      // The same song, updated (new artwork, say): the top layer follows.
      if (track !== shown.track) setLayers(list => list.map((layer, i) => (i === list.length - 1 ? { ...layer, track } : layer)))
      return
    }
    const state = usePlayerStore.getState()
    const mode = coverTransitionMode({
      automix: !!state.crossfade?.automix,
      reduceMotion,
      hasPreviousCover: !!shown.id,
    })
    const layer = { key: ++nextKey, id, track, mode, blobs: mode === 'mix' ? makeBlobs() : null }
    // At most the one on its way out stays under the new one, settled (a skip
    // mid-transition: all of it shows, not what had faded or dissolved in).
    setLayers(list => (mode === 'base' ? [layer] : [{ ...list[list.length - 1], mode: 'base' }, layer]))
  }, [id, track, performanceMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const settle = key => setLayers(list => {
    const at = list.findIndex(layer => layer.key === key)
    if (at < 0 || at !== list.length - 1) return list
    return [{ ...list[at], mode: 'base' }]
  })

  return layers.map((layer, i) => (
    <Layer key={layer.key} layer={layer} onDone={() => settle(layer.key)}>
      {render(layer.track, { top: i === layers.length - 1 })}
    </Layer>
  ))
}
