// Desktop port of Lokal Mobile's iTunes-style Cover Flow.
// Inner-edge hinges, outer-edge-forward panels, tight stacking and smooth dragging.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'framer-motion'
import { trackArtURL, trackFullArtURL } from '../onlineTracks'
import { usePerformanceMode } from '../performanceMode'
import { clampIndex, flowCoverGeometry, flowIndexAt, flowDrag, flowCoastPlan, flowEaseOut, flowPixelsPerCover, flowReleaseVelocity, flowVisibleRange, flowResponsiveSpread, flowWheelPixels, flowWheelTarget, flowWheelEase, FLOW_PERSPECTIVE, FLOW_VANISH_Y } from '../coverFlowGeometry.mjs'

const MAX_SIZE = 320 // 45% larger than the original 220px covers; still responsive
const DRAG_THRESHOLD = 6
const LONG_PRESS_MS = 500

// Rapid sweeps must display the already-cached thumbnails without decoding
// full-resolution files or restarting per-image fade transitions.
function FlowArtwork({ track, highRes }) {
  const thumbnail = trackArtURL(track)
  const full = trackFullArtURL(track) || thumbnail
  const [decoded, setDecoded] = useState(null)

  useEffect(() => {
    if (!highRes || !full || full === thumbnail || decoded === full) return undefined
    let live = true
    // Defer extraction/decoding of the original cover until motion finishes.
    // The thumbnail stays visible throughout; never fade/blank covers in flight.
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => { if (live && !image.decode) setDecoded(full) }
    image.src = full
    if (image.decode) image.decode().then(() => {
      if (live) setDecoded(full)
    }).catch(() => {})
    return () => { live = false; image.onload = null }
  }, [highRes, full, thumbnail, decoded])

  return <>
    <img src={thumbnail} draggable={false} loading="eager" decoding="async" alt=""
      className="absolute inset-0 h-full w-full object-cover" />
    {highRes && decoded === full && full !== thumbnail && (
      <img src={full} draggable={false} loading="eager" decoding="async" alt=""
        className="absolute inset-0 h-full w-full object-cover" />
    )}
  </>
}

// Memoized covers do not reconcile when the selected label advances. Their
// transforms subscribe directly to the animation MotionValue on the compositor.
const FlowCover = React.memo(function FlowCover({
  pick, index, position, flip, flipTarget, highRes, backVisible,
  size, reduced, spreadValue, onSelect, onPlay, onContextMenu,
}) {
  const geometry = useTransform([position, spreadValue], ([p, spread]) =>
    flowCoverGeometry(index - p, size, reduced, spread))
  const transform = useTransform([geometry, flip], ([g, f]) =>
    // The translated 3D panel must be INSIDE perspective division; otherwise
    // the outer and inner edges cannot reproduce the tapered iTunes triangles.
    // Shifting the vanishing point slightly below center produces the
    // reference's unequal top/bottom diagonal slopes.
    'translateY(' + (size * FLOW_VANISH_Y) + 'px) perspective(' +
    (size * FLOW_PERSPECTIVE) + 'px) translate3d(' + g.x + 'px,' +
    (-size * FLOW_VANISH_Y) + 'px,' + g.depth + 'px) rotateY(' +
    (g.angle + (flipTarget ? f * 180 : 0)) + 'deg)')
  const origin = useTransform(geometry, g => g.pivot + '% 50%')
  const opacity = useTransform(geometry, g => g.opacity)
  const zIndex = useTransform(position, p => 100 - Math.round(Math.abs(index - p) * 10))
  const artwork = trackArtURL(pick.track)

  return <motion.div data-cover-flow-item={index} style={{
    position: 'absolute', left: '50%', top: size * 0.18, width: size, height: size,
    marginLeft: -size / 2, transform, opacity, zIndex, transformOrigin: origin,
    transformStyle: 'preserve-3d', willChange: reduced ? 'auto' : 'transform',
  }}>
    <button type="button" onClick={e => { e.stopPropagation(); onSelect(index) }}
      onContextMenu={e => onContextMenu?.(e, pick.track)}
      aria-label={'Play ' + pick.track.title + ' by ' + pick.track.artist}
      className="absolute inset-0 overflow-hidden rounded-md bg-card outline-none shadow-[0_18px_40px_rgba(0,0,0,0.45)] focus-visible:ring-2 focus-visible:ring-accent"
      style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
      {artwork ? <FlowArtwork track={pick.track} highRes={highRes} /> :
        <span className="flex h-full w-full items-center justify-center text-5xl text-muted">♪</span>}
    </button>
    <div aria-hidden={!backVisible} inert={!backVisible}
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
  </motion.div>
})

export default function CoverFlow({ picks, onPlay, onContextMenu }) {
  // Home presentation is chosen explicitly in Lokal Appearance settings.
  // The OS reduced-motion preference never silently disables 3D Cover Flow.
  const reduced = usePerformanceMode()
  const count = picks.length
  // Start in the middle of the shelf, including on its first painted frame.
  const middleIndex = Math.floor(count / 2)
  const position = useMotionValue(middleIndex)
  const flip = useMotionValue(0)
  const spreadValue = useMotionValue(1)
  const stageRef = useRef(null)
  const motion = useRef(null)
  const flipSpring = useRef(null)
  const gesture = useRef(null)
  const pressTimer = useRef(null)
  const wheelTimer = useRef(null)
  const wheelFrame = useRef(null)
  const wheelStamp = useRef(null)
  const wheelGoal = useRef(null)
  const wheelSnapping = useRef(false)
  const wheelHandler = useRef(null)
  const suppressClick = useRef(false)
  const [size, setSize] = useState(MAX_SIZE)
  const [stageWidth, setStageWidth] = useState(0)
  const spread = flowResponsiveSpread(stageWidth, size, count, reduced)
  // Width changes (including animated sidebar collapse) update existing
  // cover transforms, without remounting image elements or 3D layers.
  useLayoutEffect(() => { spreadValue.set(spread) }, [spread, spreadValue])
  const pixelsPerCover = flowPixelsPerCover(size, reduced)
  const [bleed, setBleed] = useState({ left: 0, right: 0 })
  const [activeIndex, setActiveIndex] = useState(middleIndex)
  const activeRef = useRef(middleIndex)
  const [renderCenter, setRenderCenter] = useState(middleIndex)
  const renderCenterRef = useRef(middleIndex)
  const [settled, setSettled] = useState(true)
  const [flipIndex, setFlipIndex] = useState(middleIndex)
  const [flipped, setFlipped] = useState(false)
  const current = picks[clampIndex(activeIndex, count)] || picks[0]
  // Move the render window only every few covers; avoids repeatedly mounting
  // artwork trees while a fling crosses each item boundary.
  const visible = flowVisibleRange(renderCenter, count)
  const handlers = useRef(null)
  const warmed = useRef(new Map())
  // Thumbnail assets are small. Decode them one at a time when Chromium is
  // idle so a fast sweep doesn't need to fetch/decode them mid-animation.
  useEffect(() => {
    if (reduced) return undefined
    const cache = warmed.current
    const urls = [...new Set(picks.map(p => trackArtURL(p.track)).filter(Boolean))]
    for (const url of cache.keys()) if (!urls.includes(url)) cache.delete(url)
    let cancelled = false
    let job
    const schedule = () => {
      if (cancelled) return
      job = window.requestIdleCallback?.(warmNext)
    }
    const warmNext = async () => {
      if (cancelled) return
      const src = urls.find(url => !cache.has(url))
      if (!src) return
      const image = new Image()
      image.decoding = 'async'
      cache.set(src, image)
      image.src = src
      try { await image.decode?.() } catch { /* invalid art stays cached as failed */ }
      schedule()
    }
    // Electron runs Chromium, which exposes requestIdleCallback. Avoid
    // triggering a decoding wave synchronously during the first Home paint.
    schedule()
    return () => {
      cancelled = true
      if (job != null) window.cancelIdleCallback?.(job)
    }
  }, [picks, reduced])

  const handleSelect = useCallback(index => handlers.current?.select(index), [])
  const handlePlay = useCallback(index => handlers.current?.play(index), [])
  const handleMenu = useCallback((event, track) => handlers.current?.menu?.(event, track), [])

  const stopPress = () => { clearTimeout(pressTimer.current); pressTimer.current = null }
  const rotateBack = next => {
    flipSpring.current?.stop()
    if (next) setFlipIndex(activeIndex)
    setFlipped(next)
    if (reduced) flip.set(next ? 1 : 0)
    else flipSpring.current = animate(flip, next ? 1 : 0, { duration: 0.45 })
  }
  // One continuous deceleration curve from the current velocity to zero.
  // Do not hand an inertia animation to a distant spring on release.
  const moveTo = (target, duration) => {
    motion.current?.stop()
    const to = clampIndex(Math.round(target), count)
    if (reduced || duration === 0 || position.get() === to) {
      position.set(to)
      setSettled(true)
    } else {
      setSettled(false)
      motion.current = animate(position, to, {
        type: 'tween', duration, ease: flowEaseOut,
        onComplete: () => setSettled(true),
      })
    }
  }
  const settle = target => moveTo(target, .23)
  const coast = velocity => {
    const { target, duration } = flowCoastPlan(position.get(), velocity, count)
    moveTo(target, duration)
  }
  const stopWheel = () => {
    clearTimeout(wheelTimer.current)
    if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current)
    wheelFrame.current = null
    wheelStamp.current = null
    wheelGoal.current = null
    wheelSnapping.current = false
  }
  const step = by => {
    stopWheel()
    rotateBack(false)
    settle(Math.round(position.get()) + by)
  }
  useMotionValueEvent(position, 'change', value => {
    const next = clampIndex(Math.round(value), count)
    if (next !== activeRef.current) {
      activeRef.current = next
      setActiveIndex(next)
    }
    if (Math.abs(next - renderCenterRef.current) >= 4) {
      renderCenterRef.current = next
      setRenderCenter(next)
    }
  })
  useEffect(() => {
    stopWheel()
    motion.current?.stop()
    flipSpring.current?.stop()
    position.set(middleIndex)
    flip.set(0)
    activeRef.current = middleIndex
    renderCenterRef.current = middleIndex
    setActiveIndex(middleIndex)
    setRenderCenter(middleIndex)
    setSettled(true)
    setFlipIndex(middleIndex)
    setFlipped(false)
  }, [count, middleIndex]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    motion.current?.stop()
    flipSpring.current?.stop()
    clearTimeout(pressTimer.current)
    stopWheel()
  }, [])

  useLayoutEffect(() => {
    const stage = stageRef.current
    const host = stage?.parentElement
    if (!stage || !host) return undefined
    const page = stage.closest('main')
    const measure = () => {
      const width = stage.clientWidth
      if (width > 0) setStageWidth(old => Math.abs(old - width) < 1 ? old : width)
      const next = Math.min(MAX_SIZE, width * 0.52)
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
    motion.current?.stop()
    stopWheel()
    suppressClick.current = false
    gesture.current = { id: e.pointerId, start: e.clientX, last: e.clientX,
      moved: false, samples: [{ x: e.clientX, t: performance.now() }] }
    stopPress()
    const rect = e.currentTarget.getBoundingClientRect()
    // Artwork can overlap the neighbouring hit zone. Prefer the actual
    // pressed cover; use the geometry only for gaps in the stage.
    const pressedCover = e.target.closest?.('[data-cover-flow-item]')
    const touched = pressedCover ? Number(pressedCover.dataset.coverFlowItem)
      : flowIndexAt(e.clientX - rect.left, rect.width, size, position.get(), count, reduced, spread)
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
      setSettled(false)
      stopPress()
      rotateBack(false)
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    if (g.moved) {
      position.set(flowDrag(position.get(), e.clientX - g.last, pixelsPerCover, count))
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
      const velocity = flowReleaseVelocity(g.samples, performance.now(), pixelsPerCover)
      coast(velocity)
    } else {
      setSettled(true)
    }
    gesture.current = null
  }
  // Wheel and trackpad events update one destination. A single RAF follower
  // eases the rendered cover toward it, avoiding jumps on coarse wheel ticks.
  const followWheel = now => {
    wheelFrame.current = null
    const target = wheelGoal.current
    if (target === null) return
    const elapsed = wheelStamp.current === null ? 16.7 : now - wheelStamp.current
    wheelStamp.current = now
    const next = flowWheelEase(position.get(), target, elapsed)
    position.set(next)
    if (Math.abs(target - next) > 0.001) {
      wheelFrame.current = requestAnimationFrame(followWheel)
    } else {
      position.set(target)
      if (wheelSnapping.current) {
        stopWheel()
        setSettled(true)
      }
    }
  }
  const wheel = e => {
    // React's delegated wheel listeners may be passive in Chromium; this
    // handler is attached natively with { passive: false } below.
    if (e.ctrlKey || e.metaKey || count < 2) return
    const delta = flowWheelPixels(e.deltaX, e.deltaY, e.deltaMode, stageRef.current?.clientHeight || size * 1.36)
    if (!delta) return
    e.preventDefault()
    if (wheelGoal.current === null) {
      stopPress()
      rotateBack(false)
      setSettled(false)
      motion.current?.stop()
    }
    wheelSnapping.current = false
    wheelGoal.current = flowWheelTarget(position.get(), wheelGoal.current, delta, pixelsPerCover, count)
    if (wheelFrame.current === null) wheelFrame.current = requestAnimationFrame(followWheel)
    clearTimeout(wheelTimer.current)
    wheelTimer.current = setTimeout(() => {
      // Snap with the SAME interpolation, rather than switching to a new
      // tween that can abruptly change speed at the gesture's end.
      wheelSnapping.current = true
      wheelGoal.current = clampIndex(Math.round(wheelGoal.current), count)
      if (wheelFrame.current === null) wheelFrame.current = requestAnimationFrame(followWheel)
    }, 180)
  }
  wheelHandler.current = wheel
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const handleWheel = event => wheelHandler.current?.(event)
    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [count])
  const select = index => {
    if (suppressClick.current) { suppressClick.current = false; return }
    rotateBack(false)
    if (index !== activeIndex) settle(index)
    onPlay(index) // Mobile's onSelect starts playback on the first click.
  }
  handlers.current = { select, play: onPlay, menu: onContextMenu }
  if (!count) return null

  return <div className="space-y-3">
    <div ref={stageRef} tabIndex={0} role="group" aria-roledescription="cover flow"
      aria-label={'Cover Flow. ' + current.track.title + ' by ' + current.track.artist}
      aria-valuetext={(activeIndex + 1) + ' of ' + count}
      onKeyDown={e => {
        if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
        else if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(activeIndex) }
      }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDragStart={e => e.preventDefault()}
      onClickCapture={e => {
        if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false }
      }}
      onClick={e => {
        if (e.target.closest('[data-cover-flow-item]')) return
        const rect = e.currentTarget.getBoundingClientRect()
        select(flowIndexAt(e.clientX - rect.left, rect.width, size, position.get(), count, reduced, spread))
      }}
      // Leave equal vertical clearance for the perspective-rotated covers,
      // without a large unused area below the stage.
      className="relative isolate cursor-grab select-none overflow-hidden bg-black outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent/40"
      style={{ height: size * 1.36, marginLeft: -bleed.left, marginRight: -bleed.right, touchAction: 'pan-y' }}>
      {picks.slice(visible.start, visible.end).map((pick, offset) => {
        const index = visible.start + offset
        return <FlowCover key={pick.track.id}
          pick={pick} index={index} position={position} flip={flip}
          flipTarget={index === flipIndex} backVisible={flipped && index === flipIndex}
          highRes={settled && index === activeIndex}
          size={size} reduced={reduced} spreadValue={spreadValue}
          onSelect={handleSelect} onPlay={handlePlay} onContextMenu={handleMenu} />
      })}
    </div>
    <div className="mx-auto max-w-lg text-center" aria-live="polite">
      <p className="truncate text-[17px] font-semibold text-white">{current.track.title}</p>
      <p className="mt-0.5 truncate text-sm text-muted">{current.track.artist}</p>
    </div>
  </div>
}
