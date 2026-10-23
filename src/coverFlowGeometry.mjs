// iTunes Cover Flow geometry shared with Lokal Mobile's LokalCoverFlow.
// At the first neighbor the INNER artwork edge is .52 covers from centre;
// farther covers stack at .34-cover increments, with continuous velocity.
export const FLOW_SPRING = Object.freeze({ stiffness: 135, damping: 24, mass: 1 })
export const FLOW_FIRST = 0.52
export const FLOW_STEP = 0.34
export const clampIndex = (index, length) => Math.max(0, Math.min(Math.max(0, length - 1), index))
// Gesture distances must match the spacing of the active rendering mode.
export const flowPixelsPerCover = (size, reducedMotion = false) => Math.max(1, size * (reducedMotion ? 1.06 : 0.55))

function innerDistance(distance) {
  const a = Math.abs(distance)
  return a >= 1 ? FLOW_FIRST + (a - 1) * FLOW_STEP
    : 0.66 * a - 0.10 * a * a - 0.04 * a * a * a
}

// Projected side artwork center, also used for matching blank-stage taps.
function hitDistance(distance) {
  const a = Math.abs(distance)
  const t = Math.min(1, a)
  return innerDistance(a) + 0.17 * (2 * t - t * t)
}

function depthDistance(distance) {
  const a = Math.abs(distance)
  return a >= 1 ? 0.15 + (a - 1) * 0.055
    : 0.20 * a - 0.005 * a * a - 0.045 * a * a * a
}

export function flowCoverGeometry(distance, size, reduceMotion = false) {
  const ad = Math.abs(distance)
  const near = Math.min(1, ad)
  const hinge = near * near * (3 - 2 * near) // continuous slope at centre and first neighbor
  const side = Math.sign(distance)
  return {
    // The pivot moves from centre to inner edge as each panel turns.
    // Translate its inner edge just past the selected cover's side.
    x: reduceMotion ? distance * size * 1.06 : side * size * (innerDistance(ad) + 0.5 * hinge),
    pivot: reduceMotion ? 50 : 50 - side * 50 * hinge, // CSS transform-origin percentage
    // Positive Y rotation brings the left edge forward, negative the right.
    // Hence the OUTER edge of either side cover is the one facing the viewer.
    angle: reduceMotion || near === 0 ? 0 : -side * (2 * near - near * near) * 70,
    depth: reduceMotion || ad === 0 ? 0 : -size * depthDistance(ad),
    opacity: Math.max(0, Math.min(1, 5 - ad)),
  }
}

export function flowIndexAt(x, stageWidth, size, position, length, reduceMotion = false) {
  const offset = x - stageWidth / 2
  if (reduceMotion) return clampIndex(Math.round(position + offset / (size * 1.06)), length)
  const normalized = Math.abs(offset) / size
  let lo = 0
  let hi = normalized > 0.69 ? 1 + (normalized - 0.69) / FLOW_STEP : 1
  // Invert the C1 spacing curve, not the old discontinuous sine curve.
  for (let step = 0; step < 20; step++) {
    const mid = (lo + hi) / 2
    if (hitDistance(mid) < normalized) lo = mid
    else hi = mid
  }
  return clampIndex(Math.round(position + Math.sign(offset) * (lo + hi) / 2), length)
}

export function flowDrag(position, deltaX, albumWidth, length) {
  if (albumWidth <= 0) return position
  const delta = -deltaX / albumWidth
  const next = position + delta
  return next < 0 || next > length - 1 ? position + delta / 3 : next
}
export function flowTarget(position, velocity, length) {
  return clampIndex(Math.round(position + velocity * 0.30), length)
}


/** Preserve a fast flick, but never fling if the pointer paused before release. */
export function flowReleaseVelocity(samples, releasedAt, pixelsPerCover) {
  if (!samples?.length || !(pixelsPerCover > 0)) return 0
  const last = samples[samples.length - 1]
  if (releasedAt - last.t > 100) return 0
  const first = samples.find(sample => sample.t >= last.t - 100) || samples[0]
  const elapsed = last.t - first.t
  if (elapsed <= 0) return 0
  const velocity = -(last.x - first.x) * 1000 / Math.max(16, elapsed) / pixelsPerCover
  return Math.max(-20, Math.min(20, velocity))
}

/** Mount only covers close enough to enter the reflection / opacity window. */
export function flowVisibleRange(index, count, overscan = 7) {
  return {
    start: Math.max(0, index - overscan),
    end: Math.min(count, index + overscan + 1),
  }
}
