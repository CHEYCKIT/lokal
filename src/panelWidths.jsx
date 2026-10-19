// "Freeform" side panels (Settings > Appearance > Layout > Panel Width): the
// left sidebar and the right Now Playing panel get widths you set by dragging
// their inner edge. Kept per device (localStorage); off, they keep their
// fixed widths.

import React, { useRef } from 'react'
import { create } from 'zustand'

const KEY = 'lokal-panel-widths'
export const LEFT = { min: 180, max: 420, fixed: 224 }
export const RIGHT = { min: 260, max: 620, fixed: 300 }

function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { freeform: !!saved.freeform, left: Number(saved.left) || LEFT.fixed, right: Number(saved.right) || RIGHT.fixed }
  } catch { return { freeform: false, left: LEFT.fixed, right: RIGHT.fixed } }
}

export const usePanelWidths = create((set, get) => ({
  ...read(),
  set(patch) {
    set(patch)
    const { freeform, left, right } = get()
    try { localStorage.setItem(KEY, JSON.stringify({ freeform, left, right })) } catch {}
  },
}))

const clamp = (value, { min, max }) => Math.round(Math.min(max, Math.max(min, value)))

/** The width a panel shows at: its own in freeform, else the fixed one. */
export function usePanelWidth(side) {
  return usePanelWidths(s => (s.freeform ? s[side] : (side === 'left' ? LEFT : RIGHT).fixed))
}

/**
 * The strip on a panel's inner edge to drag it wider or narrower (freeform
 * only). `side` 'left' is the left sidebar (its right edge), 'right' the Now
 * Playing panel (its left edge). Double-click puts the default width back.
 */
export function PanelResizeHandle({ side }) {
  const freeform = usePanelWidths(s => s.freeform)
  const start = useRef(null)
  if (!freeform) return null
  const limits = side === 'left' ? LEFT : RIGHT
  const onPointerDown = (event) => {
    event.preventDefault()
    start.current = { x: event.clientX, width: usePanelWidths.getState()[side] }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  const onPointerMove = (event) => {
    if (!start.current) return
    const moved = event.clientX - start.current.x
    usePanelWidths.getState().set({ [side]: clamp(start.current.width + (side === 'left' ? moved : -moved), limits) })
  }
  const end = () => {
    start.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize the sidebar' : 'Resize the side panel'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => usePanelWidths.getState().set({ [side]: limits.fixed })}
      className={`absolute top-0 bottom-0 z-30 w-1.5 cursor-col-resize transition-colors hover:bg-accent/40 ${side === 'left' ? 'right-0' : 'left-0'}`}
      style={{ WebkitAppRegion: 'no-drag' }}
    />
  )
}
