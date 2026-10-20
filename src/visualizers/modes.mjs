export const VISUALIZER_MODES = [
  { id: 'milkdrop', label: 'MilkDrop' },
  { id: 'anomaly', label: 'Anomaly' },
  { id: 'spectrum', label: 'Spectrum' },
  { id: 'waves', label: 'Waves' },
  { id: 'lightning', label: 'Lightning' },
]

export const DEFAULT_ENABLED_VISUALIZERS = VISUALIZER_MODES.map(({ id }) => id)

/**
 * Read the user's enabled full-screen visualizers.
 * Missing or invalid values preserve the existing experience by enabling all.
 */
export function normalizeVisualizerModes(value) {
  let parsed = value
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { parsed = null }
  }
  if (!Array.isArray(parsed)) return [...DEFAULT_ENABLED_VISUALIZERS]
  const valid = new Set(VISUALIZER_MODES.map(({ id }) => id))
  const selected = [...new Set(parsed.filter(id => typeof id === 'string' && valid.has(id)))]
  // Keep the selector usable if a hand-edited or older setting disables all.
  return selected.length ? selected : [...DEFAULT_ENABLED_VISUALIZERS]
}
