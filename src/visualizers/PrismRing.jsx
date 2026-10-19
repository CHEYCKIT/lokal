// The side panel's Visualization: a ring whose edge is the spectrum, with
// coloured echoes of it (red, green, blue, yellow, magenta) peeking out
// around it, drawn on a transparent canvas so it sits on the panel itself.
// The echoes are the shape from a few frames ago, a little larger and
// turned, so they trail the music. Quiet or paused, it breathes on its own.

import React, { useEffect, useRef } from 'react'
import { getAnalyser, spectrumSlices, sliceLevel, useAnalyserVersion } from './audio'

const TAU = Math.PI * 2
const POINTS = 40 // around the ring (20 spectrum slices, mirrored): few points, joined straight, make sharp tips
// Each echo: how many frames behind, how much bigger, turned, and nudged
// (as a share of the radius) so it shows on one side.
const ECHOES = [
  { color: '#ff1f3d', delay: 2, scale: 1.04, turn: 0.04, dx: -0.05, dy: 0.04 },
  { color: '#1fd655', delay: 3, scale: 1.03, turn: -0.05, dx: -0.05, dy: -0.03 },
  { color: '#2a5bff', delay: 4, scale: 1.05, turn: 0.06, dx: 0.06, dy: -0.02 },
  { color: '#ffe31f', delay: 5, scale: 1.03, turn: -0.07, dx: 0.04, dy: 0.05 },
  { color: '#e23cff', delay: 6, scale: 1.02, turn: 0.08, dx: 0.01, dy: -0.05 },
]
const HISTORY = 12

export default function PrismRing({ className = '' }) {
  const canvasRef = useRef(null)
  const analyserVersion = useAnalyserVersion()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const half = POINTS / 2
    const levels = new Float32Array(half)
    const peaks = new Float32Array(half)
    const history = Array.from({ length: HISTORY }, () => new Float32Array(half))
    let head = 0
    let data = null
    let slices = null
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

    // The edge at angle i (0..POINTS) from a set of levels: mirrored, so bass
    // sits at the top and bottom and the highs at the sides.
    // Neighbouring points read far-apart slices, so they rise at different
    // moments and the edge turns into tips rather than one smooth bulge.
    const order = Array.from({ length: half }, (_, i) => (i * 7) % half)
    const edge = (set, i) => set[order[i < half ? i : POINTS - 1 - i]]

    // How far each point juts out: only what stands above the average, so the
    // loud parts make tips instead of the whole ring swelling.
    const tips = new Float32Array(POINTS)
    const shapeOf = (set) => {
      let mean = 0
      for (let i = 0; i < half; i++) mean += set[i]
      mean /= half
      for (let i = 0; i < POINTS; i++) tips[i] = Math.min(1, Math.pow(Math.max(0, edge(set, i) - mean * 0.5) * 2, 1.4))
      return tips
    }
    const point = (k, cx, cy, r, turn) => {
      const angle = (k / POINTS) * TAU - Math.PI / 2 + turn
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]
    }
    // A thin band whose outer edge has the tips; the inner edge follows it
    // at a fixed thickness, so the whole ring takes the spiky shape.
    const band = (set, cx, cy, radius, amp, turn, color) => {
      const t = shapeOf(set)
      const thickness = radius * 0.13
      ctx.beginPath()
      for (let i = 0; i <= POINTS; i++) {
        const [x, y] = point(i % POINTS, cx, cy, radius + amp * t[i % POINTS], turn)
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.closePath()
      for (let i = POINTS; i >= 0; i--) {
        const [x, y] = point(i % POINTS, cx, cy, radius - thickness + amp * 0.85 * t[i % POINTS], turn)
        if (i === POINTS) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill('evenodd')
    }

    const draw = (now) => {
      frame = requestAnimationFrame(draw)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const analyser = getAnalyser()
      if (analyser) {
        if (!data || data.length !== analyser.frequencyBinCount) {
          data = new Uint8Array(analyser.frequencyBinCount)
          slices = spectrumSlices(analyser, half, { topHz: 12000 })
        }
        analyser.getByteFrequencyData(data)
      }
      // Rises fast, falls slowly; a gentle made-up wobble when it's quiet.
      for (let i = 0; i < half; i++) {
        const heard = data && slices ? sliceLevel(data, slices[i]) / 255 : 0
        const idle = 0.12 + 0.12 * Math.sin(now / 700 + i * 0.6) * Math.sin(now / 1300 + i * 0.25)
        peaks[i] = Math.max(heard, peaks[i] - dt * 0.15)
        const target = Math.max(heard / Math.max(0.25, peaks[i]), idle)
        levels[i] += (target - levels[i]) * Math.min(1, dt * (target > levels[i] ? 25 : 9))
      }
      head = (head + 1) % HISTORY
      history[head].set(levels)

      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)
      const cx = width / 2
      const cy = height / 2
      const radius = Math.min(width, height) * 0.24
      const amp = radius * 0.38
      const spin = now / 9000

      for (const echo of ECHOES) {
        const set = history[(head - echo.delay + HISTORY * 2) % HISTORY]
        band(set, cx + echo.dx * radius, cy + echo.dy * radius, radius * echo.scale, amp, spin + echo.turn, echo.color)
      }
      band(levels, cx, cy, radius, amp, spin, '#dcdcdc')
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [analyserVersion])

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />
}
