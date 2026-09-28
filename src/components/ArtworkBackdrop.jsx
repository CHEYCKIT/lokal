// Apple Music-style colour backdrop, built from the cover itself (the way
// BitChord does it): the main process averages the art into a 6x6 grid (row 0
// = the cover's bottom edge); here each row after the first is shuffled a
// little (seeded, so a song always looks the same), smoothed up to 32x32 with
// smoothstep weights, stretched over the area and blurred. Above `seam` (where
// a full-bleed cover ends) the cover's bottom row simply continues upward, so
// the colour flows out of the artwork. Songs crossfade over 0.9 s.

import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'

const SIZE = 32
const meshCache = new Map() // trackId -> grid | null

// Settings > Appearance > Now Playing > "Colour Background". Read once and
// shared; re-read whenever settings are saved, so switching it applies
// straight away to the (always mounted) sidebar and the fullscreen player.
let backdropOn = true
let backdropLoad = null
const backdropListeners = new Set()
function refreshBackdropSetting() {
  backdropLoad = Promise.resolve(api.getSettings?.())
    .then(s => { backdropOn = s?.artwork_backdrop !== '0' })
    .catch(() => {})
    .then(() => backdropListeners.forEach(fn => fn(backdropOn)))
  return backdropLoad
}
if (typeof window !== 'undefined') window.addEventListener('lokal:settings-saved', refreshBackdropSetting)

/** true unless the colour background has been switched off in Settings. */
export function useArtworkBackdropEnabled() {
  const [on, setOn] = useState(backdropOn)
  useEffect(() => {
    backdropListeners.add(setOn)
    if (!backdropLoad) refreshBackdropSetting()
    else backdropLoad.then(() => setOn(backdropOn))
    return () => { backdropListeners.delete(setOn) }
  }, [])
  return on
}

// A track's artwork was changed: forget its colours so they're worked out again.
if (typeof window !== 'undefined') {
  window.addEventListener('lokal:track-updated', (e) => { for (const id of e.detail?.ids || []) meshCache.delete(id) })
}

export function loadMesh(trackId) {
  if (!trackId) return Promise.resolve(null)
  if (meshCache.has(trackId)) return Promise.resolve(meshCache.get(trackId))
  return Promise.resolve(api.artworkMesh?.(trackId))
    .then(grid => {
      const value = Array.isArray(grid) && grid.length ? grid : null
      if (meshCache.size > 100) meshCache.delete(meshCache.keys().next().value)
      meshCache.set(trackId, value)
      return value
    })
    .catch(() => null)
}

function seeded(seed) {
  let s = 0
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) | 0
  return () => {
    s = (s * 1664525 + 1013904223) | 0
    return ((s >>> 0) % 10000) / 10000
  }
}

/** Rows 1..n: a cyclic column shift and maybe a mirror, so it isn't just the cover blurred. */
function shuffleRows(grid, seed) {
  const rand = seeded(seed)
  return grid.map((row, i) => {
    if (i === 0) return row
    const shift = Math.floor(rand() * row.length)
    let out = row.map((_, x) => row[(x + shift) % row.length])
    if (rand() < 0.5) out = out.slice().reverse()
    return out
  })
}

const smooth = (t) => t * t * (3 - 2 * t)

function sample(grid, u, v) {
  const rows = grid.length, cols = grid[0].length
  const x = u * (cols - 1), y = v * (rows - 1)
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1)
  const tx = smooth(x - x0), ty = smooth(y - y0)
  const mix = (a, b, t) => a + (b - a) * t
  const out = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    out[c] = mix(mix(grid[y0][x0][c], grid[y0][x1][c], tx), mix(grid[y1][x0][c], grid[y1][x1][c], tx), ty)
  }
  return out
}

function paint(canvas, grid, rowsOnly = false) {
  const ctx = canvas.getContext('2d')
  const h = rowsOnly ? 1 : SIZE
  canvas.width = SIZE
  canvas.height = h
  const img = ctx.createImageData(SIZE, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = rowsOnly ? sample([grid[0], grid[0]], x / (SIZE - 1), 0) : sample(grid, x / (SIZE - 1), y / (SIZE - 1))
      const i = (y * SIZE + x) * 4
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

function Layer({ grid, seed, seam, visible }) {
  const meshRef = useRef(null)
  const capRef = useRef(null)
  useEffect(() => {
    if (!grid) return
    const shuffled = shuffleRows(grid, seed)
    if (meshRef.current) paint(meshRef.current, shuffled)
    if (capRef.current) paint(capRef.current, shuffled, true)
  }, [grid, seed])
  const stretch = { position: 'absolute', left: 0, width: '100%', imageRendering: 'auto' }
  return (
    <div className="absolute inset-0" style={{ opacity: visible ? 1 : 0, transition: 'opacity 900ms cubic-bezier(0.4, 0, 0.2, 1)' }}>
      {seam > 0 && <canvas ref={capRef} style={{ ...stretch, top: 0, height: seam + 2 }} />}
      <canvas ref={meshRef} style={{ ...stretch, top: seam, height: `calc(100% - ${seam}px)` }} />
    </div>
  )
}

/**
 * @param trackId  whose cover the colours come from
 * @param seam     px from the top where a full-bleed cover ends (0 = mesh everywhere)
 * @param onReady  called with true once colours are showing (false when the track has no art)
 */
export default function ArtworkBackdrop({ trackId, seam = 0, className = '', blur = 32, onReady }) {
  // Two slots so the old song fades out while the new one fades in.
  const [slots, setSlots] = useState([{ id: null, grid: null }, { id: null, grid: null }])
  const [front, setFront] = useState(0)
  const [revision, setRevision] = useState(0)
  const reqRef = useRef(0)

  // The track on screen was edited (new cover...): recolour.
  useEffect(() => {
    const onUpdated = (e) => { if ((e.detail?.ids || []).includes(trackId)) setRevision(r => r + 1) }
    window.addEventListener('lokal:track-updated', onUpdated)
    return () => window.removeEventListener('lokal:track-updated', onUpdated)
  }, [trackId])

  useEffect(() => {
    const req = ++reqRef.current
    loadMesh(trackId).then(grid => {
      if (req !== reqRef.current) return
      onReady?.(!!grid)
      setFront(prev => {
        const next = grid ? 1 - prev : prev
        if (grid) setSlots(s => s.map((slot, i) => (i === next ? { id: trackId, grid } : slot)))
        return next
      })
      if (!grid) setSlots([{ id: null, grid: null }, { id: null, grid: null }])
    })
  }, [trackId, revision]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`} style={{ backgroundColor: '#121212' }} aria-hidden>
      {/* Drawn larger than the box so the blur has colour to pull in at the
          edges (instead of fading to the dark base). */}
      <div className="absolute" style={{ inset: -blur * 2, filter: `blur(${blur}px)`, transform: 'translateZ(0)' }}>
        {slots.map((slot, i) => slot.grid && (
          <Layer key={i} grid={slot.grid} seed={slot.id} seam={seam > 0 ? seam + blur * 2 : 0} visible={i === front} />
        ))}
      </div>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.06), rgba(0,0,0,0.30))' }} />
    </div>
  )
}
