// Desktop and Flutter share this calibrated iTunes 7 Cover Flow projection.
// Measured against the supplied iTunes reference (central artwork = 1 unit):
// first neighbor outside edge x=±1.067, half-height=.460;
// inner edge x=±.429, half-height=.325 and shifted downward .056.
// The exposed upper/lower triangles are a perspective phenomenon: an 8%
// horizontal inset alone cannot reproduce their sloping top/bottom edges.
export const FLOW_SPRING = Object.freeze({ stiffness: 135, damping: 24, mass: 1 })
export const FLOW_FIRST = 0.91 // first side panel's 3D center translation
export const FLOW_STEP = 0.18 // farther panels stack more tightly in screen space
export const FLOW_DEPTH = 0.60 // side cover's center moves behind the facing plane
export const FLOW_FAN_ANGLE = 60 // degrees from the facing plane
export const FLOW_PERSPECTIVE = 1.92 // focal length in cover widths
export const FLOW_VANISH_Y = 0.16 // vanishing point below artwork center
const toRad = Math.PI / 180
export const FLOW_OVERLAP = 0.5 -
  (FLOW_FIRST - Math.cos(FLOW_FAN_ANGLE * toRad) / 2) /
  (1 + (FLOW_DEPTH + Math.sin(FLOW_FAN_ANGLE * toRad) / 2) / FLOW_PERSPECTIVE)
export const clampIndex = (index, length) => Math.max(0, Math.min(Math.max(0, length - 1), index))
export const flowPixelsPerCover = (size, reducedMotion = false) =>
  Math.max(1, size * (reducedMotion ? 1.06 : 0.55))

function centerDistance(a) {
  if (a >= 1) return FLOW_FIRST + (a - 1) * FLOW_STEP
  // Cubic Hermite with f(0)=0, f(1)=.91, f'(0)=.90, f'(1)=.18.
  // Keeps movement smooth as the first side cover joins the distant stack.
  return .90 * a + .75 * a * a - .74 * a * a * a
}

function depthDistance(a) {
  if (a >= 1) return FLOW_DEPTH
  // Keep the central artwork precisely on the front plane, tapering
  // smoothly to the recessed side-cover plane.
  return FLOW_DEPTH * a * a * (3 - 2 * a)
}

export function flowCoverGeometry(distance, size, reduceMotion = false) {
  const a = Math.abs(distance)
  const near = Math.min(1, a)
  const side = Math.sign(distance)
  return {
    x: reduceMotion ? distance * size * 1.06 : side * size * centerDistance(a),
    // Rotate around the CENTER of the panel, not its inset inner hinge.
    // This is essential to match the visible upper/lower iTunes triangles.
    pivot: 50,
    angle: reduceMotion || near === 0 ? 0 : -side * (2 * near - near * near) * FLOW_FAN_ANGLE,
    depth: reduceMotion || a === 0 ? 0 : -size * depthDistance(a),
    opacity: Math.max(0, Math.min(1, 5 - a)),
  }
}

/** Four actual projected corners in centered-cover coordinates.
 *  Mirrors the desktop CSS projection and Flutter Matrix4 setup exactly.
 *  Coordinates are pixels relative to the facing cover's center.
 */
export function flowProjectedCorners(distance, size = 1, reduceMotion = false) {
  const g = flowCoverGeometry(distance, size, reduceMotion)
  const theta = g.angle * toRad
  const perspective = FLOW_PERSPECTIVE * size
  const vanish = FLOW_VANISH_Y * size
  const corners = []
  for (const yy of [-size / 2, size / 2]) {
    for (const xx of [-size / 2, size / 2]) {
      const worldX = g.x + Math.cos(theta) * xx
      const worldZ = g.depth - Math.sin(theta) * xx
      const scale = reduceMotion ? 1 : 1 / (1 - worldZ / perspective)
      const x = worldX * scale
      const y = reduceMotion ? yy : vanish + (yy - vanish) * scale
      corners.push({ x, y, scale })
    }
  }
  return {
    topLeft: corners[0], topRight: corners[1],
    bottomLeft: corners[2], bottomRight: corners[3],
  }
}

// The center of a 3D side face is projected through the same camera as its
// corners. Approximate hit distances used the old hinge and selected the
// wrong cover after the triangle/perspective correction.
function projectedCenter(distance) {
  const g = flowCoverGeometry(distance, 1)
  return g.x / (1 - g.depth / FLOW_PERSPECTIVE)
}

export function flowIndexAt(x, stageWidth, size, position, length, reduceMotion = false) {
  const offset = x - stageWidth / 2
  if (reduceMotion) return clampIndex(Math.round(position + offset / (size * 1.06)), length)
  // Choose the closest DISPLAYED center, not the nearest integer to the
  // inverse curve. During a fractional drag the projected centers are
  // nonlinear, so rounding index-space distances selects the wrong album
  // around the gaps between visible covers.
  const target = offset / size
  let nearest = 0
  let nearestDistance = Infinity
  for (let index = 0; index < length; index++) {
    const distance = Math.abs(projectedCenter(index - position) - target)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = index
    }
  }
  return nearest
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

/** Mount only covers close enough to enter the visible / opacity window. */
export function flowVisibleRange(index, count, overscan = 7) {
  return {
    start: Math.max(0, index - overscan),
    end: Math.min(count, index + overscan + 1),
  }
}
