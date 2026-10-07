import React, { useEffect, useId, useRef } from 'react'
import { createBreakDots, DOTS, R0, S0, PAD, WIDTH, HEIGHT } from '../lyrics/breakDots'

// Three droplets of liquid for an instrumental break. They run on the physics in
// lyrics/breakDots.js and are drawn as one metaball: the droplets are blurred
// and thresholded into a single silhouette (so they stretch, merge and part like
// real liquid), and that silhouette is filled with each droplet's own light.
//
//   start, end   the break, in seconds on the song clock (a gap line's time/end)
//   getTime      () => seconds, read every frame while `active`
//   active       only the open break animates; closed ones cost nothing
//   size         rest diameter of one droplet, in rem
//   align        which edge of the row the droplets hug
//   pulses       optional extra times (beats, section hits) that each send a ripple

const GOO_BLUR = 4.6
const GOO_MATRIX = '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10'
const FIELD_R = 26
const EDGE = 24

function calmPreferred() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export default function LyricBreakDots({ start, end, getTime, active = true, size = 0.4, align = 'start', pulses = null, label = 'Instrumental' }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const modelRef = useRef(null)
  if (!modelRef.current) modelRef.current = createBreakDots()
  const svgRef = useRef(null)
  const groupRef = useRef(null)
  const gooRefs = useRef([])
  const fieldRefs = useRef([])

  useEffect(() => {
    const model = modelRef.current
    model.reset()
    if (!active || !(end > start) || typeof getTime !== 'function') return undefined
    const calm = calmPreferred()
    let raf = 0
    let last = performance.now()
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const frame = model.step(getTime(), (now - last) / 1000, { start, end, pulses, calm })
      last = now
      groupRef.current?.setAttribute('opacity', frame.visible ? frame.alpha.toFixed(3) : '0')
      if (svgRef.current) {
        svgRef.current.style.filter = frame.glow > 0.02
          ? `drop-shadow(0 0 ${(0.25 + 0.9 * frame.glow).toFixed(2)}rem rgba(255,255,255,${(0.5 * frame.glow).toFixed(3)}))`
          : ''
      }
      for (let i = 0; i < DOTS; i++) {
        const d = frame.dots[i]
        const goo = gooRefs.current[i]
        const field = fieldRefs.current[i]
        if (goo) { goo.setAttribute('cx', d.x.toFixed(2)); goo.setAttribute('cy', d.y.toFixed(2)); goo.setAttribute('r', d.r.toFixed(2)) }
        if (field) { field.setAttribute('cx', d.x.toFixed(2)); field.setAttribute('cy', d.y.toFixed(2)); field.setAttribute('fill-opacity', d.b.toFixed(3)) }
      }
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [active, start, end, getTime, pulses])

  const scale = size / (R0 * 2)
  const trim = `${-(PAD - R0) * scale}rem`
  const box = { x: -EDGE, y: -EDGE, width: WIDTH + EDGE * 2, height: HEIGHT + EDGE * 2 }
  const rest = (i) => WIDTH / 2 + (i - (DOTS - 1) / 2) * S0

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={`${WIDTH * scale}rem`}
      height={`${HEIGHT * scale}rem`}
      style={{ display: 'block', flexShrink: 0, overflow: 'visible', [align === 'end' ? 'marginRight' : 'marginLeft']: trim }}
    >
      <defs>
        <filter id={`${id}-goo`} filterUnits="userSpaceOnUse" {...box} colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation={GOO_BLUR} result="blur" />
          <feColorMatrix in="blur" type="matrix" values={GOO_MATRIX} />
        </filter>
        <radialGradient id={`${id}-light`}>
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-shape`} maskUnits="userSpaceOnUse" {...box}>
          <g filter={`url(#${id}-goo)`}>
            {Array.from({ length: DOTS }, (_, i) => (
              <circle key={i} ref={el => { gooRefs.current[i] = el }} cx={rest(i)} cy={HEIGHT / 2} r={R0 * 0.78} fill="#fff" />
            ))}
          </g>
        </mask>
      </defs>
      <g ref={groupRef} mask={`url(#${id}-shape)`} opacity="0">
        {Array.from({ length: DOTS }, (_, i) => (
          <circle key={i} ref={el => { fieldRefs.current[i] = el }} cx={rest(i)} cy={HEIGHT / 2} r={FIELD_R} fill={`url(#${id}-light)`} fillOpacity="0.3" />
        ))}
      </g>
    </svg>
  )
}
