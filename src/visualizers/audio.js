// Visualizations: animations that move with the music, wherever they are in
// the app (the player bar's bars, the side panel's Visualization tab...).
// They all read the one AnalyserNode App.jsx puts at the end of the playback
// graph (both crossfade decks go through it), so they show what is heard.
// It only exists once audio has started: until then a visualization stays still.

import { useEffect, useState } from 'react'

/** The playback analyser, or null before audio has started. */
export function getAnalyser() {
  return (typeof window !== 'undefined' && window.__lokalAnalyser) || null
}

/** Re-renders when the analyser appears (the audio graph is built on first play). */
export function useAnalyserVersion() {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const ready = () => setVersion(v => v + 1)
    window.addEventListener('lokal:analyser-ready', ready)
    return () => window.removeEventListener('lokal:analyser-ready', ready)
  }, [])
  return version
}

/**
 * Loudness over time, from the waveform (time domain): what PowerAudio's
 * visualizer moves with. Call update(seconds since the last call) once a
 * frame; it reads the analyser itself and is all zeros without one.
 *   samples / smooth   the waveform, and one that falls back slowly
 *   averageGain        mean loudness now
 *   linearized         follows it at a fixed speed (1 a second)
 *   firstOrder         follows it smoothly
 */
export function createLoudness(size = 256) {
  const state = {
    samples: new Float32Array(size),
    smooth: new Float32Array(size),
    averageGain: 0,
    linearized: 0,
    firstOrder: 0,
    update(dt) {
      const analyser = getAnalyser()
      if (analyser && analyser.fftSize === size) analyser.getFloatTimeDomainData(state.samples)
      else state.samples.fill(0)
      let sum = 0
      for (let i = 0; i < size; i++) sum += Math.abs(state.samples[i])
      state.averageGain = sum / (size / 2)
      state.linearized = Math.max(0, state.linearized + dt * (state.averageGain > state.linearized ? 1 : -1))
      state.firstOrder += 0.5 * (state.averageGain - state.firstOrder) * dt
      for (let i = 0; i < size; i++) {
        const v = state.samples[i]
        state.smooth[i] = v > state.smooth[i] ? v : state.smooth[i] + 0.5 * (v - state.smooth[i]) * dt
      }
    },
  }
  return state
}

/**
 * Splits the analyser's spectrum into `count` slices, narrow in the bass and
 * wider towards the highs (as ears hear it), up to `topHz`. Returns
 * [from, to] bin positions (fractional) for sliceLevel.
 */
export function spectrumSlices(analyser, count, { topHz = 16000, curve = 1.8 } = {}) {
  const bins = analyser.frequencyBinCount
  const nyquist = (analyser.context?.sampleRate || 44100) / 2
  const top = Math.min(bins - 1, topHz / (nyquist / bins))
  const at = share => top * Math.pow(share, curve)
  return Array.from({ length: count }, (_, i) => [at(i / count), at((i + 1) / count)])
}

/**
 * One slice's level (0-255) from getByteFrequencyData's `data`: its loudest
 * bin, or for a slice narrower than a bin (the analyser has only 128) a
 * reading between its two nearest bins, so neighbouring bass slices don't all
 * show the same bin.
 */
export function sliceLevel(data, [from, to]) {
  if (to - from < 1) {
    const pos = (from + to) / 2
    const bin = Math.floor(pos)
    const next = Math.min(data.length - 1, bin + 1)
    return data[bin] + (data[next] - data[bin]) * (pos - bin)
  }
  let peak = 0
  for (let b = Math.floor(from); b <= Math.min(data.length - 1, Math.ceil(to)); b++) if (data[b] > peak) peak = data[b]
  return peak
}

/** The accent colour as #rrggbb (for canvases, which can't read CSS variables). */
export function accentColor(fallback = '#ffffff') {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || fallback
}

/** `color` when it's #rrggbb, else `fallback` ('accent' is the accent colour). */
export function pickColor(color, fallback) {
  if (/^#[0-9a-f]{6}$/i.test(color || '')) return color
  return color === 'accent' ? accentColor() : fallback
}
