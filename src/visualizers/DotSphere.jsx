// The side panel's Visualization: a sphere of dots whose surface folds with
// the music (after an abstract "colourful mesh" vector): the bass swells big
// lobes, the mids twist them, the highs ripple the surface. Dots facing out
// and pushed outwards glow orange, the folds and far side fade to magenta
// and violet. Transparent, so it sits on the panel's own background. Quiet
// or paused, it keeps folding slowly on its own.

import React, { useEffect, useRef } from 'react'
import { getAnalyser, useAnalyserVersion } from './audio'

const DOTS = 1100
const ORANGE = [255, 138, 31]
const MAGENTA = [231, 72, 160]
const VIOLET = [86, 60, 255]

// Points spread evenly over a sphere (Fibonacci lattice).
function spherePoints(count) {
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (i / (count - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const a = i * golden
    return [Math.cos(a) * r, y, Math.sin(a) * r]
  })
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
function colorAt(t) {
  return t < 0.5 ? mix(VIOLET, MAGENTA, t * 2) : mix(MAGENTA, ORANGE, (t - 0.5) * 2)
}

// The analyser's spectrum as three levels (0-1): bass, mids, highs.
function bands(data) {
  const n = data.length
  const avg = (from, to) => {
    let sum = 0
    for (let i = Math.floor(from * n); i < Math.floor(to * n); i++) sum += data[i]
    return sum / Math.max(1, Math.floor(to * n) - Math.floor(from * n)) / 255
  }
  return [avg(0, 0.06), avg(0.06, 0.3), avg(0.3, 0.8)]
}

// Kept light: few dots, square ones (cheaper than circles), drawn in a
// handful of colour batches instead of one by one, at most 30 frames a
// second, and not at all while it's hidden or scrolled away.
const FRAME_MS = 1000 / 30
const SHADES = 8

export default function DotSphere({ className = '' }) {
  const canvasRef = useRef(null)
  const analyserVersion = useAnalyserVersion()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const points = spherePoints(DOTS)
    const shades = Array.from({ length: SHADES }, (_, i) => {
      const [r, g, b] = colorAt(i / (SHADES - 1))
      return `rgb(${r},${g},${b})`
    })
    // Per frame: each dot's position, size and shade; buckets[side][shade]
    // lists the dots to draw together.
    const xs = new Float32Array(DOTS), ys = new Float32Array(DOTS), sizes = new Float32Array(DOTS)
    const buckets = [0, 1].map(() => Array.from({ length: SHADES }, () => []))
    const level = [0, 0, 0]
    let data = null
    let frame = 0
    let last = performance.now()
    let lastDraw = 0
    let visible = true

    const resize = () => {
      // 1 canvas pixel per CSS pixel: plenty for dots, a quarter of the work on high-DPI screens.
      const { width, height } = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(width))
      canvas.height = Math.max(1, Math.round(height))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
    seen.observe(canvas)

    const draw = (now) => {
      frame = requestAnimationFrame(draw)
      if (!visible || document.hidden || now - lastDraw < FRAME_MS) return
      lastDraw = now
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const analyser = getAnalyser()
      let heard = [0, 0, 0]
      if (analyser) {
        if (!data || data.length !== analyser.frequencyBinCount) data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)
        heard = bands(data)
      }
      for (let b = 0; b < 3; b++) {
        level[b] += (heard[b] - level[b]) * Math.min(1, dt * (heard[b] > level[b] ? 14 : 4))
      }
      const [bass, mids, highs] = level
      const t = now / 1000

      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)
      const cx = width / 2
      const cy = height / 2
      const radius = Math.min(width, height) * 0.24
      const dotSize = Math.max(1, radius / 60)
      const turnY = t * 0.25
      const turnX = 0.35 + Math.sin(t * 0.2) * 0.15
      const sy = Math.sin(turnY), cyR = Math.cos(turnY), sx = Math.sin(turnX), cxR = Math.cos(turnX)
      // How much the surface folds: always a little, more with the music.
      const lobes = 0.16 + bass * 0.3
      const twist = 0.07 + mids * 0.16
      const ripple = highs * 0.06
      for (const side of buckets) for (const list of side) list.length = 0

      for (let i = 0; i < DOTS; i++) {
        const p = points[i]
        const px = p[0], py = p[1], pz = p[2]
        // Several folds along different directions crumple it like cloth.
        const fold =
          lobes * 0.6 * Math.sin(px * 2.1 + t * 0.9) * Math.cos(py * 1.7 - t * 0.7) +
          lobes * 0.5 * Math.sin(py * 3.1 - pz * 2.4 + t * 1.1) +
          lobes * 0.4 * Math.cos(pz * 3.7 + px * 1.9 - t * 0.8) +
          twist * Math.sin(pz * 4.3 + py * 3.2 + t * 1.6) +
          ripple * Math.sin(px * 11 + py * 9 + pz * 7 + t * 6)
        const r = 1 + fold
        // Turn the sphere: around the vertical axis, then tilt.
        const x1 = px * r * cyR - pz * r * sy
        const z1 = px * r * sy + pz * r * cyR
        const y = py * r * cxR - z1 * sx
        const z = py * r * sx + z1 * cxR
        const depth = 2.6 / (2.6 - z) // perspective
        xs[i] = cx + x1 * radius * depth
        ys[i] = cy + y * radius * depth
        sizes[i] = dotSize * depth * (0.85 + Math.max(0, fold) * 1.2)
        // Like the vector: the middle (facing us) violet, the rims and the
        // folds pushed outwards orange.
        const warm = Math.min(1, Math.max(0, 1.05 - Math.max(0, z) * 1.1 + fold * 1.8))
        buckets[z < 0 ? 0 : 1][Math.round(warm * (SHADES - 1))].push(i)
      }
      // The far side first and dimmer, then the near side over it.
      for (let side = 0; side < 2; side++) {
        ctx.globalAlpha = side ? 1 : 0.35
        for (let s = 0; s < SHADES; s++) {
          const list = buckets[side][s]
          if (!list.length) continue
          ctx.fillStyle = shades[s]
          ctx.beginPath()
          for (const i of list) ctx.rect(xs[i] - sizes[i] / 2, ys[i] - sizes[i] / 2, sizes[i], sizes[i])
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); seen.disconnect() }
  }, [analyserVersion])

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />
}
