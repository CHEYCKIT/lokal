// Home → Local → "Made for you": the twelve picks (src/madeForYou.js) on a
// carousel that rolls round like the outside of a cylinder: the card in the
// middle is the biggest and highest, the others shrink and sink toward the
// edges, and the row loops. Drag it, scroll it sideways or use the arrow
// keys; it settles on a card. A click plays (the card the press started on,
// unless it was a drag). Hovering a card lifts it a little.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { Play, Sparkles } from 'lucide-react'
import FadeImg from './FadeImg'
import { trackArtURL } from '../onlineTracks'

const ASPECT = 3 / 4 // card width / height
const MAX_HEIGHT = 250 // the middle card's height, when there's room
const VISIBLE = 5 // card slots across the row
const MIN_SCALE = 0.72 // the edge cards' size, from the middle one's
const ARC = 0.27 // how far the edge cards sink, from the card height
const GAP = 0.08 // space between cards, from the card width
const DRAG_THRESHOLD = 6 // px: past this, a press is a drag, not a click
const SPRING = { type: 'spring', stiffness: 170, damping: 26, mass: 1 }
const TOP = 14 // px above the middle card (room for a hovered card to rise 8px)

// Size at `u` cards from the middle: full in the middle, MIN_SCALE from halfway out.
const half = VISIBLE / 2
const scaleAt = u => Math.min(1, Math.abs(u) / half) >= 1 ? MIN_SCALE : MIN_SCALE + (1 - MIN_SCALE) * Math.cos((Math.abs(u) / half) * Math.PI / 2)
// Where the card's centre sits: the sizes of the cards before it added up, so
// smaller cards pack closer and nothing overlaps.
function centreAt(u) {
  const a = Math.abs(u)
  const inner = Math.min(a, half)
  const area = MIN_SCALE * inner + (1 - MIN_SCALE) * (2 * half / Math.PI) * Math.sin((inner / half) * Math.PI / 2) + MIN_SCALE * Math.max(0, a - half)
  return Math.sign(u) * area
}
const wrap = (value, count) => value - Math.round(value / count) * count

function Card({ index, count, scroll, width, height, children, onPress }) {
  const offset = useTransform(scroll, s => wrap(index - s, count))
  const x = useTransform(offset, o => centreAt(o) * width * (1 + GAP))
  const scale = useTransform(offset, scaleAt)
  const y = useTransform(offset, o => height * ARC * (1 - Math.cos(Math.min(1, Math.abs(o) / half) * Math.PI / 2)) + height * ARC * Math.max(0, Math.abs(o) - half) * 0.5)
  const zIndex = useTransform(offset, o => 100 - Math.round(Math.abs(o) * 10))
  const opacity = useTransform(offset, o => Math.abs(o) > half + 1 ? 0 : 1)
  return (
    <motion.div style={{ x, y, scale, zIndex, opacity, width, height, marginLeft: -width / 2, top: TOP }}
      className="absolute left-1/2 will-change-transform" onClick={onPress}>
      {children}
    </motion.div>
  )
}

export default function MadeForYou({ picks, onPlay, onContextMenu }) {
  const reduceMotion = useReducedMotion()
  const scroll = useMotionValue(0)
  const stage = useRef(null)
  const [size, setSize] = useState({ width: 0, height: MAX_HEIGHT })
  const drag = useRef(null)
  const dragged = useRef(false)
  const moving = useRef(null)
  const wheelTimer = useRef(null)
  const count = picks.length
  // The middle card at rest on the first pick.
  useEffect(() => { scroll.set(0) }, [count]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const element = stage.current
    if (!element) return undefined
    const measure = () => {
      const width = element.clientWidth
      // The row (VISIBLE slots at their sizes) fits the width.
      const rowWidth = (centreAt(half) * 2 + MIN_SCALE) * (1 + GAP)
      const cardWidth = Math.min(MAX_HEIGHT * ASPECT, width / rowWidth)
      setSize({ width: cardWidth, height: cardWidth / ASPECT })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const settle = (target, velocity = 0) => {
    moving.current?.stop()
    const to = Math.round(target)
    moving.current = reduceMotion ? (scroll.set(to), null) : animate(scroll, to, { ...SPRING, velocity })
  }
  const step = by => settle(Math.round(scroll.get()) + by)

  const onPointerDown = event => {
    if (event.button !== 0) return
    dragged.current = false
    moving.current?.stop()
    drag.current = { x: event.clientX, start: scroll.get(), moved: false, last: [{ x: event.clientX, t: performance.now() }], pointer: event.pointerId }
  }
  const onPointerMove = event => {
    const state = drag.current
    if (!state || event.pointerId !== state.pointer) return
    const dx = event.clientX - state.x
    if (!state.moved && Math.abs(dx) > DRAG_THRESHOLD) { state.moved = true; event.currentTarget.setPointerCapture?.(event.pointerId) }
    if (!state.moved) return
    scroll.set(state.start - dx / (size.width * (1 + GAP)))
    state.last = [...state.last.slice(-4), { x: event.clientX, t: performance.now() }]
  }
  const onPointerUp = event => {
    const state = drag.current
    if (!state || event.pointerId !== state.pointer) return
    if (state.moved) {
      // A flick keeps rolling a little before it settles.
      const [first, last] = [state.last[0], state.last[state.last.length - 1]]
      const seconds = Math.max(0.016, (last.t - first.t) / 1000)
      const velocity = -((last.x - first.x) / seconds) / (size.width * (1 + GAP)) // cards per second
      settle(scroll.get() + Math.max(-4, Math.min(4, velocity * 0.25)), velocity)
    }
    // The click that ends a drag isn't a click (cleared by the next press).
    dragged.current = state.moved
    drag.current = null
  }
  // Sideways scrolling (trackpad, shift + wheel) rolls it; up and down still scroll the page.
  const onWheel = event => {
    const dx = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0
    if (!dx) return
    moving.current?.stop()
    scroll.set(scroll.get() + dx / (size.width * (1 + GAP)))
    clearTimeout(wheelTimer.current)
    wheelTimer.current = setTimeout(() => settle(scroll.get()), 120)
  }
  useEffect(() => () => { clearTimeout(wheelTimer.current); moving.current?.stop() }, [])
  const onKeyDown = event => {
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1) }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) }
  }

  if (!picks.length) return null
  // The middle card at the top; down to the bottom of the lowest whole card
  // (half way out: sunk by ARC, at MIN_SCALE, scaled about its centre).
  const stageHeight = TOP + size.height * (ARC + (1 + MIN_SCALE) / 2) + 14
  return (
    <section aria-roledescription="carousel" aria-label="Made for you">
      <div className="mb-3 flex items-center gap-2"><Sparkles size={14} className="text-accent" /><h2 className="text-xs font-display uppercase tracking-widest text-muted">Made for you</h2></div>
      <div ref={stage} tabIndex={0} onKeyDown={onKeyDown} onWheel={onWheel}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        className="relative isolate -mx-2 cursor-grab touch-pan-y select-none overflow-hidden outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent/40 rounded-2xl"
        // isolate: the cards' z-index (the middle one on top) stays inside the carousel, under the full screen player.
        style={{ height: stageHeight }}>
        {size.width > 0 && picks.map((pick, index) => (
          <Card key={pick.track.id} index={index} count={count} scroll={scroll} width={size.width} height={size.height}
            onPress={() => { if (dragged.current) { dragged.current = false; return } onPlay(index) }}>
            <button type="button" aria-label={`Play ${pick.track.title} by ${pick.track.artist}`} onContextMenu={event => onContextMenu?.(event, pick.track)}
              className="group relative block h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-card text-left shadow-[0_18px_40px_rgba(0,0,0,0.45)] transition-[translate,box-shadow] duration-300 ease-out hover:shadow-[0_26px_50px_rgba(0,0,0,0.55)] motion-safe:hover:-translate-y-2">
              {trackArtURL(pick.track) ? <FadeImg src={trackArtURL(pick.track)} className="pointer-events-none absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-black" />}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
              <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-[rgb(var(--bg-rgb))] opacity-0 shadow-lg transition-opacity group-hover:opacity-100"><Play size={20} fill="currentColor" /></span>
              <span className="absolute inset-x-0 bottom-0 p-3.5">
                <span className="block truncate text-sm font-semibold text-white">{pick.track.title}</span>
                <span className="block truncate text-xs text-white/70">{pick.track.artist}</span>
                <span className="mt-1.5 inline-block max-w-full truncate rounded-full bg-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/80 backdrop-blur-sm">{pick.mix.name}</span>
              </span>
            </button>
          </Card>
        ))}
      </div>
    </section>
  )
}
