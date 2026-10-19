// The side panel's Visualization: a sphere of dots that only moves with the
// music. At rest (paused, quiet) it is a still sphere.
//
// How it reacts (the usual audio-reactive sphere recipe: each point pushed
// out along its normal by the part of the spectrum it stands for, plus a
// beat pulse):
//   - every dot listens to one slice of the spectrum, by latitude: the bass
//     round the equator, the highs towards the poles, so each band moves its
//     own part of the sphere;
//   - each slice is measured against its own recent peak, so quiet songs and
//     quiet highs still show;
//   - a little noise breaks the bands into folds; it only advances with the
//     music's energy, so nothing drifts when it's quiet;
//   - a beat (the bass jumping above its recent average) swells the sphere
//     for a moment.
// Colours come from the song's cover (its two most vivid colours), else from
// the theme's accent: the calm surface in one, what the music pushes out in
// the other.
//
// Kept light: ~1100 square dots drawn in a few colour batches, 30 frames a
// second, 1 canvas pixel per CSS pixel, nothing while hidden or off screen.

import React, { useEffect, useRef } from 'react'
import { getAnalyser, spectrumSlices, sliceLevel, accentColor, useAnalyserVersion } from './audio'

const DOTS = 1100
const SLICES = 24
const SHADES = 8
const FRAME_MS = 1000 / 30
const TILT = 0.45 // seen a little from above, and it stays that way

function spherePoints(count) {
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (i / (count - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const a = i * golden
    return [Math.cos(a) * r, y, Math.sin(a) * r]
  })
}

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
function hslToRgb([h, s, l]) {
  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  return [0, 8, 4].map(n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))))
}

/** Two colours from the accent: itself, and a deeper neighbour hue. */
function accentPalette() {
  const accent = accentColor('#ff8a1f')
  const rgb = /^#[0-9a-f]{6}$/i.test(accent) ? hexToRgb(accent) : [255, 138, 31]
  const [h, s] = rgbToHsl(rgb)
  return { calm: hslToRgb([(h + 220) % 360, Math.max(0.55, s), 0.55]), loud: rgb }
}

/** The cover's two most vivid, different colours, or null if it can't be read. */
function coverPalette(image) {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 24
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(image, 0, 0, 24, 24)
    const px = g.getImageData(0, 0, 24, 24).data
    const picks = []
    for (let i = 0; i < px.length; i += 4) {
      const [h, s, l] = rgbToHsl([px[i], px[i + 1], px[i + 2]])
      if (l < 0.15 || l > 0.9) continue
      picks.push({ h, s, l, score: s * (1 - Math.abs(l - 0.55)) })
    }
    if (picks.length < 10) return null
    picks.sort((a, b) => b.score - a.score)
    const first = picks[0]
    const hueGap = p => Math.min(Math.abs(p.h - first.h), 360 - Math.abs(p.h - first.h))
    const second = picks.find(p => hueGap(p) > 50) || { ...first, h: (first.h + 200) % 360 }
    const vivid = p => hslToRgb([p.h, Math.max(0.6, p.s), Math.min(0.62, Math.max(0.5, p.l))])
    return { loud: vivid(first), calm: vivid(second) }
  } catch {
    return null // a cover from another site can't be read back
  }
}

export default function DotSphere({ className = '', artSrc = null }) {
  const canvasRef = useRef(null)
  const paletteRef = useRef(null)
  const analyserVersion = useAnalyserVersion()

  // The colours: the cover's when it can be read, else the accent's.
  useEffect(() => {
    paletteRef.current = accentPalette()
    if (!artSrc) return undefined
    let live = true
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => { if (live) paletteRef.current = coverPalette(image) || accentPalette() }
    image.src = artSrc
    return () => { live = false }
  }, [artSrc])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const points = spherePoints(DOTS)
    // The spectrum slice each dot listens to: bass round the equator, highs at the poles.
    const sliceOf = points.map(([, y]) => Math.min(SLICES - 1, Math.floor(Math.abs(y) * SLICES)))
    const levels = new Float32Array(SLICES)
    const peaks = new Float32Array(SLICES).fill(0.2)
    const xs = new Float32Array(DOTS), ys = new Float32Array(DOTS), sizes = new Float32Array(DOTS)
    const buckets = [0, 1].map(() => Array.from({ length: SHADES }, () => []))
    let shades = []
    let shadesFor = null
    let data = null
    let slices = null
    let phase = 0
    let bassAvg = 0
    let beat = 0
    let sinceBeat = 1
    let frame = 0
    let last = performance.now()
    let lastDraw = 0
    let visible = true

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(width))
      canvas.height = Math.max(1, Math.round(height))
    }
    resize()
    const sized = new ResizeObserver(resize)
    sized.observe(canvas)
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
    seen.observe(canvas)

    const draw = (now) => {
      frame = requestAnimationFrame(draw)
      if (!visible || document.hidden || now - lastDraw < FRAME_MS) return
      lastDraw = now
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now

      const palette = paletteRef.current || accentPalette()
      if (palette !== shadesFor) {
        shadesFor = palette
        shades = Array.from({ length: SHADES }, (_, i) => {
          const t = i / (SHADES - 1)
          return `rgb(${palette.calm.map((v, k) => Math.round(v + (palette.loud[k] - v) * t)).join(',')})`
        })
      }

      const analyser = getAnalyser()
      if (analyser) {
        if (!data || data.length !== analyser.frequencyBinCount) {
          data = new Uint8Array(analyser.frequencyBinCount)
          slices = spectrumSlices(analyser, SLICES, { topHz: 14000 })
        }
        analyser.getByteFrequencyData(data)
      }
      let energy = 0
      for (let s = 0; s < SLICES; s++) {
        const heard = data && slices ? sliceLevel(data, slices[s]) / 255 : 0
        peaks[s] = Math.max(heard, peaks[s] - dt * 0.08, 0.2)
        const target = Math.pow(heard / peaks[s], 2.6) * Math.min(1, heard * 4) // quiet = nothing
        levels[s] += (target - levels[s]) * Math.min(1, dt * (target > levels[s] ? 30 : 9))
        energy += levels[s]
      }
      energy /= SLICES
      // A beat: the bass jumping well above its recent average.
      const bass = (levels[0] + levels[1] + levels[2]) / 3
      bassAvg += (bass - bassAvg) * Math.min(1, dt * 2)
      sinceBeat += dt
      if (bass > 0.25 && bass > bassAvg * 1.3 && sinceBeat > 0.2) { beat = 1; sinceBeat = 0 }
      beat *= Math.exp(-dt * 8)
      // The folds only move with the music.
      phase += dt * energy * 4

      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)
      const cx = width / 2
      const cy = height / 2
      const radius = Math.min(width, height) * 0.23 * (1 + beat * 0.16)
      const amp = 0.62
      const dotSize = Math.max(1, radius / 55)
      const st = Math.sin(TILT), ct = Math.cos(TILT)
      for (const side of buckets) for (const list of side) list.length = 0

      for (let i = 0; i < DOTS; i++) {
        const [px, py, pz] = points[i]
        const wave = Math.sin(px * 5 + phase) * Math.sin(pz * 5 - phase * 0.7) * Math.cos(py * 4 + phase * 0.5)
        const fold = 0.35 + 0.65 * Math.abs(wave) // peaks and troughs, not an even swell
        const push = amp * levels[sliceOf[i]] * fold
        const r = 1 + push
        const y = py * r * ct - pz * r * st
        const z = py * r * st + pz * r * ct
        const depth = 2.8 / (2.8 - z)
        xs[i] = cx + px * r * radius * depth
        ys[i] = cy + y * radius * depth
        sizes[i] = dotSize * depth * (0.85 + push * 1.6)
        // Calm surface in one colour, what the music pushes out in the other;
        // the rim a touch warmer so the ball reads as round.
        const shade = Math.min(1, push / amp * 2.2 + (1 - Math.abs(z)) * 0.2 + beat * 0.35)
        buckets[z < 0 ? 0 : 1][Math.round(shade * (SHADES - 1))].push(i)
      }
      for (let side = 0; side < 2; side++) {
        ctx.globalAlpha = side ? 1 : 0.3
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
    return () => { cancelAnimationFrame(frame); sized.disconnect(); seen.disconnect() }
  }, [analyserVersion])

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />
}
