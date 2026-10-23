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
// Closely follows iCarousel's CoverFlow2 kinetic model (not Apple's private
// implementation): 0.95 deceleration, multiplier 30, velocity threshold 2.
// Integrate uniform deceleration and choose the destination ONCE. Finishing
// with zero velocity avoids an inertia->spring handoff and the resulting jerk.
export const FLOW_DECELERATION_RATE = 0.95
export const FLOW_DECELERATION_MULTIPLIER = 30
export const flowEaseOut = progress => 1 - (1 - progress) ** 2

export function flowCoastPlan(position, velocity, length) {
  const speed = Math.abs(velocity)
  // Mouse releases are frequently below two covers/s. A hard threshold here
  // made the same drag either coast or halt depending on a tiny velocity change.
  const distance = velocity / (2 * FLOW_DECELERATION_MULTIPLIER * (1 - FLOW_DECELERATION_RATE))
  const target = clampIndex(Math.round(position + distance), length)
  const travel = target - position
  // Match the initial easing slope to the release velocity when moving in its
  // direction; finish with zero velocity, without an inertia/spring handoff.
  const followsVelocity = travel * velocity > 0 && speed > .01
  const duration = followsVelocity
    ? Math.max(.12, Math.min(.70, 2 * Math.abs(travel) / speed))
    : Math.max(.10, Math.min(.20, .10 + Math.abs(travel) * .20))
  return { target, duration, distance }
}




/** Estimate pointer velocity without a binary cutoff when the mouse pauses.
 * Idle gaps smoothly attenuate momentum: a moving release coasts, a held
 * mouse comes naturally to rest before final fractional alignment.
 */
export function flowReleaseVelocity(samples, releasedAt, pixelsPerCover) {
  if (!samples?.length || !(pixelsPerCover > 0)) return 0
  const last = samples[samples.length - 1]
  const first = samples.find(sample => sample.t >= last.t - 120) || samples[0]
  const elapsed = last.t - first.t
  if (elapsed <= 0) return 0
  const measured = -(last.x - first.x) * 1000 / Math.max(16, elapsed) / pixelsPerCover
  const idle = Math.max(0, releasedAt - last.t)
  const velocity = measured * Math.exp(-idle / 85)
  return Math.max(-20, Math.min(20, velocity))
}

/** Mount only covers close enough to enter the reflection / opacity window. */
export function flowVisibleRange(index, count, overscan = 7) {
  return {
    start: Math.max(0, index - overscan),
    end: Math.min(count, index + overscan + 1),
  }
}
