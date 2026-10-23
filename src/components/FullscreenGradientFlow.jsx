import { useEffect, useState } from 'react'
import { loadMesh } from './ArtworkBackdrop'

// ArtworkBackdrop already caches the 6x6 colour mesh. Reuse its palette
// rather than inventing unrelated accent colours for the moving fullscreen background.
const FALLBACK = [[112, 66, 150], [100, 80, 140]]

function brighten(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return null
  return rgb.slice(0, 3).map(channel => Math.min(255, Math.round(Number(channel) * 1.18 + 16)))
}

function pickPalette(mesh) {
  if (!Array.isArray(mesh) || !mesh.length || !Array.isArray(mesh[0])) return FALLBACK
  const first = mesh[0]
  const middle = mesh[Math.floor(mesh.length / 2)] || first
  const last = mesh[mesh.length - 1] || middle
  return [
    brighten(first[Math.floor(first.length / 5)]) || FALLBACK[0],
    brighten(middle[Math.floor(middle.length * 0.75)]) || brighten(last[0]) || FALLBACK[1],
  ]
}

/**
 * Visible, slow colour movement above the static baked artwork backdrop.
 * Only transforms and opacity animate; the expensive artwork mesh is not
 * rebuilt and no full-screen blur is re-evaluated for every frame.
 */
export default function FullscreenGradientFlow({ trackId, running = true }) {
  const [palette, setPalette] = useState({ trackId: null, colours: FALLBACK })
  useEffect(() => {
    if (!trackId) return undefined
    let current = true
    loadMesh(trackId).then(mesh => {
      if (current) setPalette({ trackId, colours: pickPalette(mesh) })
    }).catch(() => {})
    return () => { current = false }
  }, [trackId])

  const colours = palette.trackId === trackId ? palette.colours : FALLBACK
  const cssColours = {
    '--fullscreen-flow-a': `rgb(${colours[0].join(' ')} / 0.75)`,
    '--fullscreen-flow-b': `rgb(${colours[1].join(' ')} / 0.75)`,
    '--fullscreen-flow-state': running ? 'running' : 'paused',
  }
  return (
    <div className="fullscreen-gradient-flow absolute inset-0" style={cssColours} aria-hidden="true">
      <div className="fullscreen-gradient-blob fullscreen-gradient-blob-a" />
      <div className="fullscreen-gradient-blob fullscreen-gradient-blob-b" />
    </div>
  )
}
