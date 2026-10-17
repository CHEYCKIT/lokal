// AutoMix's cover dissolve (src/components/MixCovers.jsx), the way iOS 27
// does it: the next song's cover grows in through soft, cloudy blobs, blurred
// at first and sharpening. A CSS mask of radial gradients, one per blob,
// redrawn each frame; the same on artwork, moving covers and Canvas clips.

const BLOBS = 14

/** A transition's blobs: where each grows from, when it starts, how big it gets. */
export function makeBlobs(count = BLOBS, random = Math.random) {
  return Array.from({ length: count }, (_, i) => ({
    x: 8 + random() * 84,
    y: 8 + random() * 84,
    // A few start at once, the rest over the first two thirds: the new
    // cover keeps arriving in patches rather than all at once.
    delay: i < 3 ? random() * 0.06 : 0.06 + random() * 0.66,
    size: 30 + random() * 34, // % of the cover, at full growth
  }))
}

export const easeOut = t => 1 - (1 - t) ** 3
export const clamp01 = t => Math.min(1, Math.max(0, t))
const easeInOut = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

/** The mask at `p` (0…1): each blob grown so far, and the whole cover once nearly done. */
export function blobMask(blobs, p) {
  const layers = []
  for (const blob of blobs) {
    // Each blob grows quickly at first, then settles (between an ease-out and an ease-in-out).
    const t = clamp01((p - blob.delay) / (1 - blob.delay))
    const grown = 0.65 * easeOut(t) + 0.35 * easeInOut(t)
    if (grown <= 0) continue
    const r = (blob.size * grown).toFixed(2)
    layers.push(`radial-gradient(ellipse ${r}% ${r}% at ${blob.x.toFixed(1)}% ${blob.y.toFixed(1)}%, #000 45%, rgba(0,0,0,0.6) 70%, transparent 100%)`)
  }
  const fill = clamp01((p - 0.82) / 0.18)
  if (fill > 0) layers.push(`linear-gradient(rgba(0,0,0,${fill.toFixed(3)}), rgba(0,0,0,${fill.toFixed(3)}))`)
  return layers.length ? layers.join(', ') : 'linear-gradient(transparent, transparent)'
}

/** The blur of the incoming cover at `p`: soft at first, sharp near the end. */
export const blobBlur = p => 16 * (1 - easeOut(clamp01(p / 0.88)))


/** Artwork gets the same AutoMix dissolve for every audio-transition mode,
 * including Off. This is a visual handover only; it does not start an audio mix.
 * Manual Next/Previous use the same track-change path as automatic transitions.
 */
export function coverTransitionMode({ reduceMotion, hasPreviousCover }) {
  if (reduceMotion || !hasPreviousCover) return 'base'
  return 'mix'
}
