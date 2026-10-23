// Same non-looping iPod Cover Flow geometry as Lokal Mobile's LokalCoverFlow.
// Keep these constants aligned with lib/widgets/lokal/lokal_cover_flow.dart.
export const FLOW_SPRING = Object.freeze({ stiffness: 170, damping: 26, mass: 1 })
export const clampIndex = (index, length) => Math.max(0, Math.min(Math.max(0, length - 1), index))
export function flowCoverGeometry(distance, size, reduceMotion = false) {
  const ad = Math.abs(distance)
  const near = Math.min(1, ad)
  const side = Math.sign(distance)
  const x = reduceMotion ? distance * size * 1.06
    : side * (ad <= 1 ? size * 0.82 * Math.sin(near * Math.PI / 2)
      : size * (0.82 + (ad - 1) * 0.75))
  return {
    x,
    angle: reduceMotion ? 0 : -side * near * 70,
    depth: reduceMotion ? 0 : -size * (0.22 * near + 0.08 * Math.max(0, ad - 1)),
    opacity: Math.max(0, Math.min(1, 5 - ad)),
  }
}
export function flowIndexAt(x, stageWidth, size, position, length, reduceMotion = false) {
  const offset = x - stageWidth / 2
  const near = size * 0.82
  const d = reduceMotion ? offset / (size * 1.06)
    : Math.abs(offset) <= near
      ? Math.asin(Math.max(-1, Math.min(1, offset / near))) / (Math.PI / 2)
      : Math.sign(offset) * (1 + (Math.abs(offset) - near) / (size * 0.75))
  return clampIndex(Math.round(position + d), length)
}
export function flowDrag(position, deltaX, albumWidth, length) {
  if (albumWidth <= 0) return position
  const delta = -deltaX / albumWidth
  const next = position + delta
  return next < 0 || next > length - 1 ? position + delta / 3 : next
}
export function flowTarget(position, velocity, length) {
  return clampIndex(Math.round(position + velocity * 0.32), length)
}
