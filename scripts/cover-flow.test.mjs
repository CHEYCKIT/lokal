import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { clampIndex, flowCoverGeometry, flowIndexAt, flowDrag, flowCoastPlan, flowEaseOut, flowPixelsPerCover, flowReleaseVelocity, flowVisibleRange, FLOW_SPRING, FLOW_DECELERATION_RATE, FLOW_DECELERATION_MULTIPLIER } from '../src/coverFlowGeometry.mjs'

const shelf = readFileSync(new URL('../src/components/MadeForYou.jsx', import.meta.url), 'utf8')
const flow = readFileSync(new URL('../src/components/CoverFlow.jsx', import.meta.url), 'utf8')
const home = readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8')

test('iTunes Cover Flow: outside edges face forward and inside hinges align tightly', () => {
  const size = 220
  const centre = flowCoverGeometry(0, size)
  assert.equal(centre.angle, 0)
  assert.equal(centre.pivot, 50)
  assert.equal(centre.x, 0)
  assert.equal(centre.depth, 0)
  assert.equal(centre.opacity, 1)
  const right = flowCoverGeometry(1, size)
  const left = flowCoverGeometry(-1, size)
  assert.equal(right.angle, -70, 'right-side outer edge faces forward')
  assert.equal(left.angle, 70, 'left-side outer edge faces forward')
  assert.equal(right.pivot, 0, 'right-side hinge is its inside/left edge')
  assert.equal(left.pivot, 100, 'left-side hinge is its inside/right edge')
  assert.ok(Math.abs((right.x - size / 2) - size * .52) < 0.001)
  assert.ok(Math.abs((left.x + size / 2) + size * .52) < 0.001)
  assert.equal(left.x, -right.x)
  assert.ok(Math.abs(right.depth + size * .15) < 0.001)
  const farther = flowCoverGeometry(2, size)
  assert.ok(Math.abs((farther.x - right.x) / size - .34) < 0.001)
  assert.ok(farther.depth < right.depth)
  assert.equal(FLOW_SPRING.stiffness, 135)
  assert.equal(FLOW_SPRING.damping, 24)
  assert.equal(FLOW_SPRING.mass, 1)
})

test('compact spacing is smooth across the first-neighbor boundary', () => {
  const size = 220
  const epsilon = 0.0001
  const x0 = flowCoverGeometry(1, size).x
  const before = (x0 - flowCoverGeometry(1 - epsilon, size).x) / (size * epsilon)
  const after = (flowCoverGeometry(1 + epsilon, size).x - x0) / (size * epsilon)
  assert.ok(Math.abs(before - after) < .001, 'no sudden jump in swipe velocity')
  assert.equal(flowCoverGeometry(-1, size).angle, 70)
  assert.equal(flowCoverGeometry(1, size).angle, -70)
})

test('Cover Flow is bounded, rubber-bands at both ends and respects reduced motion', () => {
  assert.equal(clampIndex(-3, 12), 0)
  assert.equal(clampIndex(20, 12), 11)
  assert.equal(flowCoastPlan(10.1, 9, 12).target, 11)
  assert.equal(flowCoastPlan(0.1, -20, 12).target, 0)
  assert.ok(flowDrag(0, 50, 132, 12) < 0)
  assert.ok(flowDrag(11, -50, 132, 12) > 11)
  const reduced = flowCoverGeometry(1, 220, true)
  assert.equal(reduced.angle, 0)
  assert.equal(reduced.depth, 0)
  assert.equal(reduced.x, 220 * 1.06)
})

test('Cover Flow hit-testing matches mobile sine-spaced neighbors', () => {
  const width = 900
  const size = 220
  const centre = width / 2
  assert.equal(flowIndexAt(centre, width, size, 5, 12), 5)
  assert.equal(flowIndexAt(centre + size * 0.69, width, size, 5, 12), 6)
  assert.equal(flowIndexAt(centre - size * 0.69, width, size, 5, 12), 4)
  assert.equal(flowIndexAt(centre + size * 5, width, size, 11, 12), 11)
})

test('Home keeps its original play queue and menu while replacing the old cylinder carousel', () => {
  assert.ok(home.includes('onPlay={index => playQueue(pickTracks, index, madeForYouContext)}'))
  assert.ok(home.includes('onContextMenu={openPickMenu}'))
  assert.ok(!home.includes('onOpenFlow={() => goHome(\'flow\')}'))
  assert.ok(!shelf.includes('onOpenFlow'))
  assert.ok(!flow.includes('onOpenFlow'))
  assert.ok(shelf.includes('<CoverFlow picks={picks} onPlay={onPlay}'))
  assert.ok(!shelf.includes('const ARC'))
  assert.ok(!shelf.includes('const wrap ='))
  assert.ok(flow.includes('onPlay(index) // Mobile'))
  assert.ok(flow.includes('onContextMenu={e => onContextMenu?.(e, pick.track)}'))
  assert.ok(flow.includes('onPointerMove={move} onPointerUp={up}'))
  assert.ok(flow.includes('onWheel={wheel}'))
  assert.ok(flow.includes('ArrowRight'))
  assert.ok(flow.includes('rotateBack(!flipped)'))
  assert.ok(flow.includes('scaleY(-1)'))
  assert.ok(flow.includes('perspective('))
})

test('Cover Flow is 45% larger and opens centered, without starting Flow', () => {
  assert.ok(flow.includes('const MAX_SIZE = 320'), 'maximum square cover increases from 220 to 320 pixels')
  assert.ok(flow.includes('Math.min(MAX_SIZE, stage.clientWidth * 0.52)'), 'covers still scale on narrow windows')
  assert.ok(flow.includes('const middleIndex = Math.floor(count / 2)'), 'even/odd-length shelves start in the middle')
  assert.ok(flow.includes('useMotionValue(middleIndex)'), 'the first rendered frame must be centered')
  assert.ok(flow.includes('useState(middleIndex)'), 'track details match the centered cover')
  assert.ok(flow.includes('position.set(middleIndex)'), 'reset selection when the shelf count changes')
  assert.ok(!flow.includes('Open Flow'))
})

test('Cover Flow artwork cannot be natively dragged as a file', () => {
  assert.ok(flow.includes('src={focused && !failed ? full : thumbnail} draggable={false}'))
  assert.ok(flow.includes('<img src={artwork} alt="" draggable={false} loading="lazy"'))
  assert.ok(flow.includes('onDragStart={e => e.preventDefault()}'), 'suppress browser drag image preview')
  assert.ok(flow.includes('onPointerDown={down} onPointerMove={move} onPointerUp={up}'), 'keep gesture-controlled movement')
})

test('Cover Flow matches the tighter iTunes reflective stage on desktop', () => {
  assert.ok(flow.includes('transformOrigin: origin'), 'the artwork pivot interpolates with drag')
  assert.ok(flow.includes('origin = useTransform(position'), 'pivot remains fluid between covers')
  assert.ok(flow.includes('top: size * 1.005'), 'reflections touch the artwork')
  assert.ok(flow.includes('bg-black'), 'reflection stage is black like iTunes')
  assert.ok(flow.includes('flowPixelsPerCover(size, reduced)'), 'gesture scale follows the rendered mode')
})

test('drag, fling, and trackpad use one-cover spacing in both rendering modes', () => {
  const size = 220
  assert.equal(flowPixelsPerCover(size, true), size * 1.06)
  assert.equal(flowPixelsPerCover(size, false), size * 0.55)
  for (const reduced of [true, false]) {
    const unit = flowPixelsPerCover(size, reduced)
    assert.equal(flowDrag(4, -unit, unit, 12), 5, 'one cover moved = one index')
  }
  assert.ok(flow.includes('flowDrag(position.get(), e.clientX - g.last, pixelsPerCover, count)'))
  assert.ok(flow.includes('/ pixelsPerCover'), 'release velocity and wheel use the same mode-aware scale')
})

test('long-press selects the actual pressed cover rather than blank-stage hit testing', () => {
  assert.ok(flow.includes("e.target.closest?.('[data-cover-flow-item]')"))
  assert.ok(flow.includes('Number(pressedCover.dataset.coverFlowItem)'))
  assert.ok(flow.includes("pressedCover ? Number(pressedCover.dataset.coverFlowItem)"))
  assert.ok(flow.includes(': flowIndexAt('), 'blank-stage hit testing still uses the distance curve')
})

test('high-speed releases retain measured momentum but a paused pointer cannot fling', () => {
  const samples = [
    { x: 300, t: 1000 },
    { x: 250, t: 1025 },
    { x: 200, t: 1050 },
    { x: 150, t: 1075 },
  ]
  assert.ok(flowReleaseVelocity(samples, 1080, 176) > 5)
  assert.ok(flowReleaseVelocity(samples, 1250, 176) < 1.5, 'a paused mouse loses speed smoothly')
  assert.equal(flowReleaseVelocity([{ x: 150, t: 1080 }], 1081, 176), 0)
  assert.equal(flowReleaseVelocity(samples, 1080, 0), 0)
  assert.equal(flowReleaseVelocity([{ x: 2000, t: 1000 }, { x: -2000, t: 1016 }], 1016, 176), 20, 'reject noisy spikes')
})

test('24-track shelves render only the nearby covers during long glides', () => {
  assert.deepEqual(flowVisibleRange(12, 24), { start: 5, end: 20 })
  assert.deepEqual(flowVisibleRange(0, 24), { start: 0, end: 8 })
  assert.deepEqual(flowVisibleRange(23, 24), { start: 16, end: 24 })
  assert.deepEqual(flowVisibleRange(1, 1), { start: 0, end: 1 })
  assert.ok(flow.includes('picks.slice(visible.start, visible.end)'), 'do not mount every distant cover')
  assert.ok(flow.includes("type: 'tween', duration, ease: flowEaseOut"), 'one deceleration curve reaches its snapped target')
  assert.ok(flow.includes('flowCoastPlan(position.get(), velocity, count)'), 'compute physical stopping position once')
  assert.ok(!flow.includes("type: 'inertia'"), 'remove long OS-independent inertia')
  assert.ok(!flow.includes("type: 'spring'"), 'no spring takeover after a flick')
  assert.ok(flow.includes('flowReleaseVelocity(g.samples, performance.now(), pixelsPerCover)'))
})

test('Home Cover Flow has no visible heading but keeps its accessible shelf label', () => {
  assert.ok(shelf.includes("aria-label={t('Made for you')}"), 'keep screen-reader context')
  assert.ok(!shelf.includes('<h2'), 'remove visible Made for you heading')
  assert.ok(!shelf.includes('Sparkles'), 'remove redundant heading icon')
  assert.ok(shelf.includes('<CoverFlow picks={picks}'), 'retain playback shelf')
})

test('perspective-expanded side corners and reflections fit inside the stage', () => {
  assert.ok(flow.includes('top: size * 0.18'), 'move artwork down from the clipping boundary')
  assert.ok(flow.includes('height: size * 1.54'), 'grow stage to retain reflection space')
  const inset = 0.18
  const perspective = 5 // CSS perspective is 5 × cover size
  for (const distance of [-4, -3, -2, -1, -.75, -.5, .5, .75, 1, 2, 3, 4]) {
    const { angle, depth } = flowCoverGeometry(distance, 1)
    // Outer edge comes toward the viewer by sin(angle), increasing apparent height.
    const outerDepth = depth + Math.sin(Math.abs(angle) * Math.PI / 180)
    const scale = perspective / (perspective - outerDepth)
    const topRise = Math.max(0, (scale - 1) / 2)
    assert.ok(topRise < inset, `side ${distance} upper corner must not clip`)
  }
  assert.ok(inset + 1.005 + .30 < 1.54, 'reflection also fits the enlarged stage')
})

test('iCarousel-inspired fixed deceleration finishes without a secondary snap', () => {
  assert.equal(FLOW_DECELERATION_RATE, .95)
  assert.equal(FLOW_DECELERATION_MULTIPLIER, 30)
  const fast = flowCoastPlan(8, 12, 24)
  assert.equal(fast.target, 12, '12 covers/s travels about four covers')
  assert.ok(Math.abs(fast.duration - 2 / 3) < .001, 'approximately 2/3 second to stop')
  const reverse = flowCoastPlan(12, -12, 24)
  assert.equal(reverse.target, 8, 'reverses with symmetric timing')
  assert.ok(Math.abs(reverse.duration - fast.duration) < 1e-9)
  assert.equal(flowCoastPlan(8.2, 0, 24).target, 8, 'release without fling aligns nearest cover')
  assert.ok(flowCoastPlan(8.2, 0, 24).duration <= .22, 'tiny alignment is quick')
  assert.equal(flowCoastPlan(22, 20, 24).target, 23, 'end cannot overrun the last cover')
  assert.ok(flowCoastPlan(22, 20, 24).duration < .25, 'end stops promptly')
  assert.equal(flowEaseOut(0), 0)
  assert.equal(flowEaseOut(1), 1)
  assert.ok(flowEaseOut(.9) > .98, 'movement approaches zero continuously at the end')
  assert.ok(flowCoastPlan(8, 8, 24).duration <= .7, 'flick never drags on')
})

test('mouse click-and-drag physics is independent of the unchanged wheel handler', () => {
  assert.ok(flow.includes("onWheel={wheel}"), 'wheel handler remains unchanged')
  assert.ok(flow.includes("e.shiftKey ? e.deltaY : 0"), 'shift wheel handling remains unchanged')
  assert.ok(flow.includes('setTimeout(() => settle(position.get()), 170)'), 'original wheel settle timing is retained')
  assert.ok(flow.includes('coast(velocity)'), 'mouse pointer release alone uses the new coast')
  assert.ok(flow.includes('flowReleaseVelocity(g.samples, performance.now(), pixelsPerCover)'))
})

test('mouse drag release has no velocity cliff or abrupt low-speed mode switch', () => {
  const samples = [
    { x: 400, t: 1000 }, { x: 340, t: 1030 },
    { x: 280, t: 1060 }, { x: 220, t: 1090 },
  ]
  const immediately = flowReleaseVelocity(samples, 1090, 176)
  const after99ms = flowReleaseVelocity(samples, 1189, 176)
  const after101ms = flowReleaseVelocity(samples, 1191, 176)
  assert.ok(immediately > after99ms)
  assert.ok(after99ms > after101ms && after101ms > 0, 'no hard 100ms cutoff')
  assert.ok(Math.abs(after99ms - after101ms) < .10, 'release velocity varies smoothly')
  assert.equal(flowReleaseVelocity(samples, 2000, 176) < .001, true)
  const before = flowCoastPlan(4.1, 1.99, 24)
  const after = flowCoastPlan(4.1, 2.01, 24)
  assert.ok(Math.abs(before.distance - after.distance) < .01, 'no 2-cover-per-second discontinuity')
  assert.equal(before.target, after.target, 'similar mouse speeds reach same cover')
  assert.ok(before.duration <= .70 && after.duration <= .70)
  assert.ok(!flow.includes("type: 'inertia'"), 'no separate inertia animation')
  assert.ok(!flow.includes("type: 'spring'"), 'no spring takeover on release')
})
