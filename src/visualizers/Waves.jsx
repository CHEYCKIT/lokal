// The player bar's "Waves": two soft filled waves standing on the bar's
// bottom edge under the seek bar, rising with the music. Both are drawn from
// the spectrum, each from its own reading of it (the front one from between
// the back one's points, and quicker), so their peaks move apart; tapered to
// nothing at both ends.
//   width / height   the area, px
//   strength         how high the music throws them, 1 = as loud as it is
//   colorBack / colorFront   #rrggbb ('accent': the accent colour)
//   opacity          0-1

import React, { useEffect, useRef } from 'react'
import { getAnalyser, pickColor, sliceLevel, spectrumSlices, useAnalyserVersion } from './audio'

// 30 frames a second, like the other player bar visualizations.
const FRAME_MS = 1000 / 30
// Room above the tallest peak for the glow.
const GLOW = 10

/** A smooth closed shape through the points, down to the baseline at both ends. */
function fillWave(ctx, points, width, height, color) {
  ctx.beginPath()
  ctx.moveTo(0, height)
  ctx.lineTo(points[0].x, points[0].y)
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]
    // Catmull-Rom through the points, as cubic Béziers.
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6, Math.min(height, p1.y + (p2.y - p0.y) / 6),
      p2.x - (p3.x - p1.x) / 6, Math.min(height, p2.y - (p3.y - p1.y) / 6),
      p2.x, p2.y,
    )
  }
  ctx.lineTo(width, height)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.fill()
}

export default function Waves({ isPlaying, width = 480, height = 50, strength = 1, colorBack = '#38bdf8', colorFront = '#f472d0', opacity = 0.85, className = '' }) {
  const canvasRef = useRef(null)
  const analyserVersion = useAnalyserVersion()
  const canvasHeight = height + GLOW

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(canvasHeight * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const back = pickColor(colorBack, '#38bdf8')
    const front = pickColor(colorFront, '#f472d0')

    // About one point every 28 px; the front wave reads between the back one's.
    const count = Math.max(8, Math.round(width / 28))
    const analyser = getAnalyser()
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    const slices = analyser ? spectrumSlices(analyser, count * 2, { topHz: 12000 }) : []
    const levels = [new Float32Array(count), new Float32Array(count)]

    let frame = null
    let last = 0
    const draw = (now = performance.now()) => {
      frame = requestAnimationFrame(draw)
      if (now - last < FRAME_MS - 1) return
      last = now
      const live = analyser && isPlaying
      if (live) analyser.getByteFrequencyData(data)
      let moving = false
      for (let w = 0; w < 2; w++) {
        for (let i = 0; i < count; i++) {
          let target = 0
          if (live) {
            const value = sliceLevel(data, slices[i * 2 + w]) / 255
            // The highs are quieter: lifted a little so the right side moves too.
            target = Math.min(1, value * value * strength * 1.4 * (1 + (i / count) * 0.8))
          }
          // Up quickly, down gently; the front wave a little quicker.
          const rise = w ? 0.55 : 0.4
          levels[w][i] += (target - levels[w][i]) * (target > levels[w][i] ? rise : 0.12)
          if (levels[w][i] > 0.002) moving = true
        }
      }
      ctx.clearRect(0, 0, width, canvasHeight)
      ctx.shadowBlur = 12
      ctx.globalAlpha = 0.9
      for (let w = 0; w < 2; w++) {
        const points = Array.from({ length: count }, (_, i) => {
          // Tapered: nothing at the very ends, full height in the middle.
          const share = (i + 0.5 + (w ? 0.5 : 0)) / (count + 0.5)
          const taper = Math.sin(Math.PI * share)
          return { x: share * width, y: canvasHeight - 1.5 - levels[w][i] * taper * height }
        })
        fillWave(ctx, points, width, canvasHeight, w ? front : back)
      }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
      // Paused (or no audio yet): once the waves have settled, stop drawing.
      if (!moving && !live) { cancelAnimationFrame(frame); frame = null }
    }
    draw()
    return () => { if (frame) cancelAnimationFrame(frame) }
  }, [isPlaying, width, height, canvasHeight, strength, colorBack, colorFront, analyserVersion])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ display: 'block', width, height: canvasHeight, opacity }}
    />
  )
}
