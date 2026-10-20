// The side panel's Visualization: MilkDrop, through Butterchurn (its WebGL
// port), with the presets of Butterchurn's "minimal" pack (the light ones,
// minus the two heaviest).
//
// Kept cheap: it renders at 320×180 and the panel scales that up (MilkDrop's
// soft look hides it), 30 frames a second, nothing while it's hidden, off
// screen or paused (paused, it holds its last frame), and the engine and
// presets are only downloaded when the Visualization is first shown.
//
// It listens to the same analyser as the other visualizations. A new song
// blends to another preset; the button in the corner skips to the next.

import React, { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { SkipForward } from 'lucide-react'
import { getAnalyser, useAnalyserVersion } from './audio'
import { loadMilkDropPresets } from './milkDropPresets.mjs'

const WIDTH = 320
const HEIGHT = 180
const FRAME_MS = 1000 / 30
const BLEND_SECONDS = 2.5
let enginePromise = null
function loadEngine() {
  enginePromise ||= Promise.all([
    import('butterchurn'),
    loadMilkDropPresets(),
  ]).then(([engine, presets]) => {
    const butterchurn = [engine, engine?.default, engine?.default?.default]
      .find(value => value && typeof value.createVisualizer === 'function')
    if (!butterchurn) throw new Error('Butterchurn did not load')
    return { butterchurn, presets }
  }).catch(error => {
    enginePromise = null
    throw error
  })
  return enginePromise
}

function webglWorks() {
  try { return !!document.createElement('canvas').getContext('webgl2') } catch { return false }
}

const MilkDrop = React.forwardRef(function MilkDrop({
  className = '',
  isPlaying = true,
  trackId = null,
  presetNames = null,
  onPresetChange,
  showNextButton = true,
}, ref) {
  const canvasRef = useRef(null)
  const vizRef = useRef(null)
  const presetsRef = useRef([])
  const allPresetsRef = useRef([])
  const allowedPresetsRef = useRef(presetNames)
  allowedPresetsRef.current = presetNames
  const allowedPresetKey = Array.isArray(presetNames) ? presetNames.join('\u001f') : ''
  const indexRef = useRef(-1)
  const playingRef = useRef(isPlaying)
  playingRef.current = isPlaying
  const [failed, setFailed] = useState(() => !webglWorks())
  const [presetName, setPresetName] = useState('')
  const analyserVersion = useAnalyserVersion()

  const filterPresets = source => {
    const allowed = allowedPresetsRef.current
    if (!Array.isArray(allowed) || allowed.length === 0) return source
    const filtered = source.filter(({ name }) => allowed.includes(name))
    return filtered.length ? filtered : source
  }

  const showPreset = (index, blend = BLEND_SECONDS) => {
    const list = presetsRef.current
    const viz = vizRef.current
    if (!viz || !list.length) return
    indexRef.current = ((index % list.length) + list.length) % list.length
    const { name, preset } = list[indexRef.current]
    try { viz.loadPreset(preset, blend); setPresetName(name); onPresetChange?.(name) } catch {}
  }
  const randomPreset = () => {
    const count = presetsRef.current.length
    if (count < 2) return 0
    let next = indexRef.current
    while (next === indexRef.current) next = Math.floor(Math.random() * count)
    return next
  }

  const showPresetRef = useRef(null)
  showPresetRef.current = showPreset
  useImperativeHandle(ref, () => ({
    nextPreset: () => showPresetRef.current?.(indexRef.current + 1, 1),
    previousPreset: () => showPresetRef.current?.(indexRef.current - 1, 1),
  }), [])

  useEffect(() => {
    if (failed) return undefined
    const analyser = getAnalyser()
    const canvas = canvasRef.current
    if (!analyser || !canvas) return undefined
    let cancelled = false
    let frame = 0
    let lastDraw = 0
    let visible = true
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
    seen.observe(canvas)

    loadEngine().then(({ butterchurn, presets }) => {
      if (cancelled) return
      canvas.width = WIDTH
      canvas.height = HEIGHT
      const viz = butterchurn.createVisualizer(analyser.context, canvas, { width: WIDTH, height: HEIGHT, pixelRatio: 1, textureRatio: 1 })
      viz.connectAudio(analyser)
      vizRef.current = viz
      allPresetsRef.current = presets
      presetsRef.current = filterPresets(presets)
      showPreset(randomPreset(), 0)
      const draw = (now) => {
        frame = requestAnimationFrame(draw)
        if (!visible || document.hidden || !playingRef.current || now - lastDraw < FRAME_MS) return
        lastDraw = now
        try { viz.render() } catch {}
      }
      frame = requestAnimationFrame(draw)
    }).catch((error) => { console.warn('[visualizer] MilkDrop could not start:', error); if (!cancelled) setFailed(true) })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      seen.disconnect()
      const viz = vizRef.current
      vizRef.current = null
      try { viz?.disconnectAudio(analyser) } catch {}
    }
  }, [analyserVersion, failed])

  // Re-apply the allowlist without restarting the WebGL engine.
  useEffect(() => {
    const all = allPresetsRef.current
    if (!all.length) return
    const currentName = presetsRef.current[indexRef.current]?.name
    presetsRef.current = filterPresets(all)
    const currentIndex = presetsRef.current.findIndex(({ name }) => name === currentName)
    showPreset(currentIndex >= 0 ? currentIndex : randomPreset(), 0)
  }, [allowedPresetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Each new song blends to another allowed preset.
  useEffect(() => { if (trackId && vizRef.current) showPreset(randomPreset()) }, [trackId])

  if (failed) return <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted">This visualization can't run here (it needs WebGL).</p>
  return (
    <div className={`group ${className}`}>
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full rounded-xl" />
      {showNextButton && (
        <button
          type="button"
          onClick={() => showPreset(indexRef.current + 1, 1)}
          title={presetName ? `Next preset (now: ${presetName})` : 'Next preset'}
          aria-label="Next preset"
          className="absolute bottom-2 right-2 rounded-full bg-black/40 p-1.5 text-white/80 opacity-0 transition-opacity hover:text-white group-hover:opacity-100 focus:opacity-100"
        >
          <SkipForward size={13} />
        </button>
      )}
    </div>
  )
})

export default MilkDrop
