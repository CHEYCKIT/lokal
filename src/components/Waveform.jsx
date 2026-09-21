import React, { useEffect, useRef, useState } from 'react'

export default function Waveform({
  isPlaying,
  className = '',
  barCount = 32,
  defaultWidth = 120,
  defaultHeight = 24,
}) {
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const dataArrayRef = useRef(null)
  const smoothedRef = useRef(null)
  const resizeObserverRef = useRef(null)
  const phaseRef = useRef(0)
  // The previous version derived cssW from canvas.parentElement.clientWidth,
  // but the parent has no width of its own -- it sizes to fit the canvas,
  // and the canvas was styled with a fixed pixel width. That's a
  // self-referential loop: the canvas always "measures" the width it already
  // has, so it never actually shrinks when the window is resized narrower.
  // Fixed by rendering the canvas at width: 100% (so its box is genuinely
  // determined by whatever flex-shrinkable wrapper it's placed in) and
  // observing the canvas's own resulting box size instead of the parent's.
  const sizeRef = useRef({ w: defaultWidth, h: defaultHeight })
  const [analyserVersion, setAnalyserVersion] = useState(0)

  useEffect(() => {
    const onAnalyserReady = () => setAnalyserVersion(v => v + 1)
    window.addEventListener('lokal:analyser-ready', onAnalyserReady)
    return () => window.removeEventListener('lokal:analyser-ready', onAnalyserReady)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      // clientWidth reflects the box the surrounding flex layout actually
      // assigned this element -- no longer circular now that the canvas's
      // own CSS width is 100% of its (independently shrinkable) wrapper.
      const cssW = canvas.clientWidth || defaultWidth
      const cssH = defaultHeight
      sizeRef.current = { w: cssW, h: cssH }

      canvas.style.height = `${cssH}px`
      canvas.width = Math.max(1, Math.floor(cssW * dpr))
      canvas.height = Math.max(1, Math.floor(cssH * dpr))

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserverRef.current = new ResizeObserver(resize)
      resizeObserverRef.current.observe(canvas)
    } else {
      window.addEventListener('resize', resize)
    }
    resize()

    if (!smoothedRef.current || smoothedRef.current.length !== barCount) {
      smoothedRef.current = new Array(barCount).fill(2)
    }

    const analyser = window.__lokalAnalyser
    const drawCapsule = (x, y, w, h, r, fill) => {
      const radius = Math.min(r, w / 2, h / 2)
      ctx.beginPath()
      ctx.moveTo(x + radius, y)
      ctx.lineTo(x + w - radius, y)
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
      ctx.lineTo(x + w, y + h - radius)
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
      ctx.lineTo(x + radius, y + h)
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
      ctx.lineTo(x, y + radius)
      ctx.quadraticCurveTo(x, y, x + radius, y)
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
    }

    if (!analyser) {
      const drawStatic = () => {
        const { w: cssW, h: cssH } = sizeRef.current
        ctx.clearRect(0, 0, cssW, cssH)
        const barWidth = Math.max(1, cssW / barCount - 2)
        for (let i = 0; i < barCount; i++) {
          const barHeight = 3 + Math.random() * 4
          const x = i * (barWidth + 2)
          const y = (cssH - barHeight) / 2
          drawCapsule(x, y, barWidth, barHeight, 2, 'rgba(255,255,255,0.18)')
        }
        animationRef.current = requestAnimationFrame(drawStatic)
      }
      drawStatic()
      return () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current)
        if (resizeObserverRef.current) resizeObserverRef.current.disconnect()
        else window.removeEventListener('resize', resize)
      }
    }

    if (!dataArrayRef.current) {
      const bufferLength = analyser.frequencyBinCount
      dataArrayRef.current = new Uint8Array(bufferLength)
    }
    const dataArray = dataArrayRef.current
    const getBarValue = (index) => {
      const nyquist = (analyser.context?.sampleRate || 44100) / 2
      const minFreq = 28
      const maxFreq = Math.min(18000, nyquist - 1)
      const startFreq = minFreq * Math.pow(maxFreq / minFreq, index / barCount)
      const endFreq = minFreq * Math.pow(maxFreq / minFreq, (index + 1) / barCount)
      const binHz = nyquist / dataArray.length
      const startBin = Math.max(0, Math.floor(startFreq / binHz))
      const endBin = Math.min(dataArray.length - 1, Math.max(startBin + 1, Math.ceil(endFreq / binHz)))
      let sum = 0
      let count = 0
      for (let b = startBin; b <= endBin; b++) {
        const v = dataArray[b] || 0
        sum += v * v
        count++
      }
      const rms = count ? Math.sqrt(sum / count) : 0
      const bassZone = index / Math.max(1, barCount - 1)
      const bassBoost = bassZone < 0.34 ? 1.5 - bassZone * 0.8 : 1
      const highLift = 1 + Math.pow(bassZone, 1.9) * 0.95
      const shaped = Math.min(255, rms * bassBoost * highLift)
      return shaped
    }

    const draw = () => {
      const { w: cssW, h: cssH } = sizeRef.current

      if (!isPlaying) {
        ctx.clearRect(0, 0, cssW, cssH)
        const barWidth = Math.max(1, cssW / barCount - 2)
        for (let i = 0; i < barCount; i++) {
          const noiseTarget = 2 + Math.random() * 2
          smoothedRef.current[i] += (noiseTarget - smoothedRef.current[i]) * 0.05
          const barHeight = Math.max(2, smoothedRef.current[i])
          const x = i * (barWidth + 2)
          const y = (cssH - barHeight) / 2
          drawCapsule(x, y, barWidth, barHeight, 2, 'rgba(255,255,255,0.18)')
        }
        animationRef.current = requestAnimationFrame(draw)
        return
      }

      analyser.getByteFrequencyData(dataArray)
      ctx.clearRect(0, 0, cssW, cssH)
      phaseRef.current += 0.08

      const gradient = ctx.createLinearGradient(0, 0, cssW, 0)
      gradient.addColorStop(0, 'rgba(255,255,255,0.3)')
      gradient.addColorStop(0.55, 'rgba(232,255,87,0.9)')
      gradient.addColorStop(1, 'rgba(255,255,255,0.95)')

      const barWidth = Math.max(1, cssW / barCount - 2)
      const center = (barCount - 1) / 2

      for (let i = 0; i < barCount; i++) {
        const value = getBarValue(i)
        const centerWeight = 1 - Math.min(1, Math.abs(i - center) / center)
        let target = Math.max(2, (value / 255) * cssH * (0.62 + centerWeight * 0.42))
        if (i > barCount * 0.74) {
          const shimmer = 1.3 + Math.sin(phaseRef.current + i * 0.55) * 1.15
          target = Math.max(target, shimmer + (value / 255) * 3.2)
        }
        const smoothFactor = i < barCount * 0.28 ? 0.24 : i > barCount * 0.74 ? 0.12 : 0.16
        smoothedRef.current[i] += (target - smoothedRef.current[i]) * smoothFactor
        const barHeight = smoothedRef.current[i]

        const x = i * (barWidth + 2)
        const y = (cssH - barHeight) / 2

        const alpha = 0.24 + (value / 255) * 0.72
        ctx.globalAlpha = alpha
        drawCapsule(x, y, barWidth, barHeight, barWidth / 2, gradient)
        ctx.globalAlpha = 1
      }

      animationRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      if (resizeObserverRef.current) resizeObserverRef.current.disconnect()
      else window.removeEventListener('resize', resize)
    }
  }, [isPlaying, barCount, defaultWidth, defaultHeight, analyserVersion])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height: `${defaultHeight}px` }}
    />
  )
}
