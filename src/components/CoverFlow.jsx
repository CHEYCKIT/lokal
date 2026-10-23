// Desktop port of Lokal Mobile's lib/widgets/lokal/lokal_cover_flow.dart.
// Preserve the exact 70° side angle, depth spacing, reflection and bounded spring.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform } from 'framer-motion'
import FadeImg from './FadeImg'
import { trackArtURL } from '../onlineTracks'
import { usePerformanceMode } from '../performanceMode'
import { useTranslation } from '../i18n'
import { clampIndex, flowCoverGeometry, flowIndexAt, flowDrag, flowTarget, FLOW_SPRING } from '../coverFlowGeometry.mjs'

const MAX_SIZE = 220
const DRAG_THRESHOLD = 6
const LONG_PRESS_MS = 500

function FlowCover({ pick, index, position, flip, activeIndex, size, reduced, flipped, onSelect, onPlay, onContextMenu }) {
  const transform = useTransform([position, flip], ([p, f]) => {
    const { x, angle, depth } = flowCoverGeometry(index - p, size, reduced)
    // Translate *outside* perspective (Flutter applies the same matrix order).
    return 'translate3d(' + x + 'px,0,0) perspective(' + (size * 5) +
      'px) translateZ(' + depth + 'px) rotateY(' + (angle + (index === activeIndex ? f * 180 : 0)) + 'deg)'
  })
  const opacity = useTransform(position, p => flowCoverGeometry(index - p, size, reduced).opacity)
  const zIndex = useTransform(position, p => 100 - Math.round(Math.abs(index - p) * 10))
  const artwork = trackArtURL(pick.track)

  return <motion.div data-cover-flow-item={index} style={{
    position: 'absolute', left: '50%', top: size * 0.06, width: size, height: size,
    marginLeft: -size / 2, transform, opacity, zIndex, transformOrigin: '50% 50%',
    transformStyle: 'preserve-3d',
  }}>
    <button type="button" onClick={e => { e.stopPropagation(); onSelect(index) }}
      onContextMenu={e => onContextMenu?.(e, pick.track)}
      aria-label={'Play ' + pick.track.title + ' by ' + pick.track.artist}
      className="absolute inset-0 overflow-hidden rounded-md bg-card outline-none shadow-[0_18px_40px_rgba(0,0,0,0.45)] focus-visible:ring-2 focus-visible:ring-accent"
      style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
      {artwork ? <FadeImg src={artwork} className="h-full w-full object-cover" /> :
        <span className="flex h-full w-full items-center justify-center text-5xl text-muted">♪</span>}
    </button>
    {/* Long-press the focused cover to see its track listing, like mobile. */}
    <div aria-hidden={!(flipped && index === activeIndex)}
      inert={!(flipped && index === activeIndex)}
      className="absolute inset-0 flex flex-col rounded-md border border-border bg-elevated p-3 shadow-lg"
      style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
      <p className="truncate text-sm font-semibold text-white">{pick.track.title}</p>
      <p className="mt-1 truncate text-xs text-muted">{pick.track.artist}</p>
      <p className="mt-2 truncate text-xs text-muted">{pick.mix.name}</p>
      <p className="mt-3 flex-1 border-t border-border pt-2 text-xs text-white/75">
        <span className="mr-2 text-muted">1.</span>{pick.track.title}
      </p>
      <button type="button" onClick={e => { e.stopPropagation(); onPlay(index) }}
        className="self-start rounded-xl bg-accent px-4 py-1.5 text-xs font-semibold text-base">PLAY</button>
    </div>
    {!reduced && artwork && <div className="pointer-events-none absolute left-0 overflow-hidden"
      style={{ top: size * 1.02, width: size, height: size * 0.32,
        maskImage: 'linear-gradient(to bottom,rgba(0,0,0,.28),transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom,rgba(0,0,0,.28),transparent)' }}>
      <img src={artwork} alt="" loading="lazy" className="block w-full object-cover"
        style={{ height: size, transform: 'scaleY(-1)', transformOrigin: 'center' }} />
    </div>}
  </motion.div>
}

export default function CoverFlow({ picks, onPlay, onContextMenu, onOpenFlow }) {
  const { t } = useTranslation()
  const reduceMotion = !!useReducedMotion()
  const performanceMode = usePerformanceMode()
  const reduced = reduceMotion || performanceMode
  const position = useMotionValue(0)
  const flip = useMotionValue(0)
  const stageRef = useRef(null)
  const spring = useRef(null)
  const flipSpring = useRef(null)
  const gesture = useRef(null)
  const pressTimer = useRef(null)
  const wheelTimer = useRef(null)
  const suppressClick = useRef(false)
  const [size, setSize] = useState(MAX_SIZE)
  const [bleed, setBleed] = useState({ left: 0, right: 0 })
  const [activeIndex, setActiveIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const count = picks.length
  const current = picks[clampIndex(activeIndex, count)] || picks[0]

  const stopPress = () => { clearTimeout(pressTimer.current); pressTimer.current = null }
  const rotateBack = next => {
    flipSpring.current?.stop()
    setFlipped(next)
    if (reduced) flip.set(next ? 1 : 0)
    else flipSpring.current = animate(flip, next ? 1 : 0, { duration: 0.45 })
  }
  const settle = (target, velocity = 0) => {
    spring.current?.stop()
    const to = clampIndex(Math.round(target), count)
    if (reduced) position.set(to)
    else spring.current = animate(position, to, { type: 'spring', ...FLOW_SPRING, velocity })
  }
  const step = by => { rotateBack(false); settle(Math.round(position.get()) + by) }
  useMotionValueEvent(position, 'change', value => {
    const next = clampIndex(Math.round(value), count)
    setActiveIndex(prev => prev === next ? prev : next)
  })
  useEffect(() => {
    position.set(0)
    flip.set(0)
    setActiveIndex(0)
    setFlipped(false)
  }, [count]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    spring.current?.stop()
    flipSpring.current?.stop()
    clearTimeout(pressTimer.current)
    clearTimeout(wheelTimer.current)
  }, [])

  useLayoutEffect(() => {
    const stage = stageRef.current
    const host = stage?.parentElement
    if (!stage || !host) return undefined
    const page = stage.closest('main')
    const measure = () => {
      const next = Math.min(MAX_SIZE, stage.clientWidth * 0.52)
      setSize(old => Math.abs(old - next) < 0.5 ? old : next)
      if (!page) return
      const area = page.getBoundingClientRect()
      const column = host.getBoundingClientRect()
      const left = Math.max(0, Math.round(column.left - area.left))
      const right = Math.max(0, Math.round(area.left + page.clientWidth - column.right))
      setBleed(old => old.left === left && old.right === right ? old : { left, right })
    }
    measure()
    const observer = new ResizeObserver(measure)
    for (const target of [stage, host, page]) if (target) observer.observe(target)
    return () => observer.disconnect()
  }, [])

  const down = e => {
    if (e.button !== 0) return
    spring.current?.stop()
    suppressClick.current = false
    gesture.current = { id: e.pointerId, start: e.clientX, last: e.clientX,
      moved: false, samples: [{ x: e.clientX, t: performance.now() }] }
    stopPress()
    const rect = e.currentTarget.getBoundingClientRect()
    const touched = flowIndexAt(e.clientX - rect.left, rect.width, size, position.get(), count, reduced)
    if (touched === activeIndex) pressTimer.current = setTimeout(() => {
      if (!gesture.current?.moved) {
        suppressClick.current = true
        rotateBack(!flipped)
      }
    }, LONG_PRESS_MS)
  }
  const move = e => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    if (!g.moved && Math.abs(e.clientX - g.start) > DRAG_THRESHOLD) {
      g.moved = true
      stopPress()
      rotateBack(false)
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    if (g.moved) {
      position.set(flowDrag(position.get(), e.clientX - g.last, Math.max(1, size * 0.6), count))
      g.samples.push({ x: e.clientX, t: performance.now() })
      if (g.samples.length > 5) g.samples.shift()
    }
    g.last = e.clientX
  }
  const up = e => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    stopPress()
    if (g.moved) {
      suppressClick.current = true
      const first = g.samples[0]
      const last = g.samples[g.samples.length - 1]
      const seconds = Math.max(0.016, (last.t - first.t) / 1000)
      const velocity = -((last.x - first.x) / seconds) / Math.max(1, size * 0.6)
      settle(flowTarget(position.get(), velocity, count), velocity)
    }
    gesture.current = null
  }
  const wheel = e => {
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0
    if (!dx) return
    e.preventDefault()
    stopPress()
    rotateBack(false)
    spring.current?.stop()
    position.set(Math.max(-0.35, Math.min(count - 0.65, position.get() + dx / Math.max(1, size * 0.6))))
    clearTimeout(wheelTimer.current)
    wheelTimer.current = setTimeout(() => settle(position.get()), 120)
  }
  const select = index => {
    if (suppressClick.current) { suppressClick.current = false; return }
    rotateBack(false)
    if (index !== activeIndex) settle(index)
    onPlay(index) // Mobile's onSelect starts playback on the first click.
  }
  if (!count) return null

  return <div className="space-y-3">
    <div ref={stageRef} tabIndex={0} role="group" aria-roledescription="cover flow"
      aria-label={'Cover Flow. ' + current.track.title + ' by ' + current.track.artist}
      aria-valuetext={(activeIndex + 1) + ' of ' + count}
      onKeyDown={e => {
        if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(activeIndex) }
      }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onWheel={wheel}
      onClickCapture={e => {
        if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false }
      }}
      onClick={e => {
        if (e.target.closest('[data-cover-flow-item]')) return
        const rect = e.currentTarget.getBoundingClientRect()
        select(flowIndexAt(e.clientX - rect.left, rect.width, size, position.get(), count, reduced))
      }}
      className="relative isolate cursor-grab select-none overflow-hidden outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent/40"
      style={{ height: size * 1.42, marginLeft: -bleed.left, marginRight: -bleed.right, touchAction: 'pan-y' }}>
      {picks.map((pick, index) => <FlowCover key={pick.track.id}
        pick={pick} index={index} position={position} flip={flip}
        activeIndex={activeIndex} size={size} reduced={reduced} flipped={flipped}
        onSelect={select} onPlay={onPlay} onContextMenu={onContextMenu} />)}
    </div>
    <div className="mx-auto max-w-lg text-center" aria-live="polite">
      <p className="truncate text-[17px] font-semibold text-white">{current.track.title}</p>
      <p className="mt-0.5 truncate text-sm text-muted">{current.track.artist}</p>
    </div>
    {onOpenFlow && <div className="flex justify-center">
      <button type="button" onClick={onOpenFlow}
        className="rounded-full border border-border bg-elevated px-5 py-2 text-xs font-display tracking-widest text-white/80 transition-colors hover:border-accent/40 hover:text-accent">
        {t('Open Flow')}
      </button>
    </div>}
  </div>
}
