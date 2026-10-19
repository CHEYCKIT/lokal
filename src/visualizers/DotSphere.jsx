// The side panel's Visualization: a sphere of dots whose surface folds with
// the music (after an abstract "colourful mesh" vector): the bass swells big
// lobes, the mids twist them, the highs ripple the surface. Dots facing out
// and pushed outwards glow orange, the folds and far side fade to magenta
// and violet. Transparent, so it sits on the panel's own background. Quiet
// or paused, it keeps folding slowly on its own.

import React, { useEffect, useRef } from 'react'
import { getAnalyser, useAnalyserVersion } from './audio'

const DOTS = 2600
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

export default function DotSphere({ className = '' }) {
  const canvasRef = useRef(null)
  const analyserVersion = useAnalyserVersion()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const points = spherePoints(DOTS)
    const projected = points.map(() => ({ x: 0, y: 0, z: 0, size: 0, color: '' }))
    const level = [0, 0, 0]
    let data = null
    let frame = 0
    let last = performance.now()

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const { width, height } = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const draw = (now) => {
      frame = requestAnimationFrame(draw)
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
      const dotSize = Math.max(0.6, radius / 120)
      const turnY = t * 0.25
      const turnX = 0.35 + Math.sin(t * 0.2) * 0.15
      const [sy, cyR, sx, cxR] = [Math.sin(turnY), Math.cos(turnY), Math.sin(turnX), Math.cos(turnX)]
      // How much the surface folds: always a little, more with the music.
      const lobes = 0.16 + bass * 0.3
      const twist = 0.07 + mids * 0.16
      const ripple = highs * 0.06

      for (let i = 0; i < points.length; i++) {
        const [px, py, pz] = points[i]
        // Several folds along different directions crumple it like cloth.
        const fold =
          lobes * 0.6 * Math.sin(px * 2.1 + t * 0.9) * Math.cos(py * 1.7 - t * 0.7) +
          lobes * 0.5 * Math.sin(py * 3.1 - pz * 2.4 + t * 1.1) +
          lobes * 0.4 * Math.cos(pz * 3.7 + px * 1.9 - t * 0.8) +
          twist * Math.sin(pz * 4.3 + py * 3.2 + t * 1.6) +
          ripple * Math.sin(px * 11 + py * 9 + pz * 7 + t * 6)
        const r = 1 + fold
        let x = px * r, y = py * r, z = pz * r
        // Turn the sphere: around the vertical axis, then tilt.
        ;[x, z] = [x * cyR - z * sy, x * sy + z * cyR]
        ;[y, z] = [y * cxR - z * sx, y * sx + z * cxR]
        const depth = 2.6 / (2.6 - z) // perspective
        const p = projected[i]
        p.x = cx + x * radius * depth
        p.y = cy + y * radius * depth
        p.z = z
        p.size = dotSize * depth * (0.85 + Math.max(0, fold) * 1.2)
        // Like the vector: the middle (facing us) violet, the rims and the
        // folds pushed outwards orange; the far side dimmer.
        const warm = Math.min(1, Math.max(0, 1.05 - Math.max(0, z) * 1.1 + fold * 1.8))
        const alpha = 0.25 + 0.75 * (z + 1) / 2
        const [rr, gg, bb] = colorAt(warm)
        p.color = `rgba(${rr},${gg},${bb},${alpha.toFixed(2)})`
      }
      projected.sort((a, b) => a.z - b.z)
      for (const p of projected) {
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [analyserVersion])

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />
}
