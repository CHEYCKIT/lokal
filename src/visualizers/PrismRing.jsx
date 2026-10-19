// The side panel's Visualization: a ring whose edge is the spectrum, with
// coloured echoes of it (red, green, blue, yellow, magenta) peeking out
// around it, drawn on a transparent canvas so it sits on the panel itself.
// The echoes are the shape from a few frames ago, a little larger and
// turned, so they trail the music. Quiet or paused, it breathes on its own.

import React, { useEffect, useRef } from 'react'
import { getAnalyser, spectrumSlices, sliceLevel, useAnalyserVersion } from './audio'

const TAU = Math.PI * 2
const POINTS = 96 // around the ring (48 spectrum slices, mirrored)
// Each echo: how many frames behind, how much bigger, turned, and nudged
// (as a share of the radius) so it shows on one side.
const ECHOES = [
  { color: '#ff1f3d', delay: 3, scale: 1.1, turn: 0.06, dx: -0.1, dy: 0.08 },
  { color: '#1fd655', delay: 5, scale: 1.08, turn: -0.08, dx: -0.11, dy: -0.06 },
  { color: '#2a5bff', delay: 7, scale: 1.1, turn: 0.11, dx: 0.11, dy: -0.05 },
  { color: '#ffe31f', delay: 9, scale: 1.08, turn: -0.13, dx: 0.08, dy: 0.1 },
  { color: '#e23cff', delay: 11, scale: 1.06, turn: 0.16, dx: 0.02, dy: -0.11 },
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
    const edge = (set, i) => set[i < half ? i : POINTS - 1 - i]

    // One closed edge, added to the current path.
    const edgePath = (set, cx, cy, radius, amp, turn) => {
      for (let i = 0; i <= POINTS; i++) {
        const k = i % POINTS
        const angle = (k / POINTS) * TAU - Math.PI / 2 + turn
        const r = radius + amp * edge(set, k)
        const x = cx + Math.cos(angle) * r
        const y = cy + Math.sin(angle) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
    }
    // A band: the outer edge pushed out by the music, the inner one pulled in.
    const band = (set, cx, cy, radius, amp, turn, color) => {
      ctx.beginPath()
      edgePath(set, cx, cy, radius, amp, turn)
      edgePath(set, cx, cy, radius * 0.9, -amp * 0.55, -turn * 1.6)
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
        const idle = 0.08 + 0.06 * Math.sin(now / 700 + i * 0.6) * Math.sin(now / 1300 + i * 0.25)
        const target = Math.max(heard, idle)
        levels[i] += (target - levels[i]) * Math.min(1, dt * (target > levels[i] ? 18 : 5))
      }
      head = (head + 1) % HISTORY
      history[head].set(levels)

      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)
      const cx = width / 2
      const cy = height / 2
      const radius = Math.min(width, height) * 0.27
      const amp = radius * 0.3
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
