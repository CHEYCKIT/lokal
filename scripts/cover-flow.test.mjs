import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { clampIndex, flowCoverGeometry, flowIndexAt, flowDrag, flowCoastPlan, flowEaseOut, flowPixelsPerCover, flowReleaseVelocity, flowVisibleRange, FLOW_SPRING, FLOW_DECELERATION_RATE, FLOW_DECELERATION_MULTIPLIER, FLOW_FIRST, FLOW_OVERLAP, FLOW_STEP, FLOW_DEPTH, FLOW_FAN_ANGLE, FLOW_PERSPECTIVE, FLOW_VANISH_Y, flowProjectedCorners } from '../src/coverFlowGeometry.mjs'

const shelf = readFileSync(new URL('../src/components/MadeForYou.jsx', import.meta.url), 'utf8')
const flow = readFileSync(new URL('../src/components/CoverFlow.jsx', import.meta.url), 'utf8')
const home = readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8')

test('projected Cover Flow triangle corners match the traced original iTunes artwork', () => {
  const center = flowCoverGeometry(0, 1)
  assert.equal(center.angle, 0)
  assert.equal(center.x, 0)
  assert.equal(center.depth, 0)
  assert.equal(center.pivot, 50)
  assert.equal(FLOW_FIRST, .91)
  assert.equal(FLOW_STEP, .18)
  assert.equal(FLOW_DEPTH, .60)
  assert.equal(FLOW_FAN_ANGLE, 60)
  assert.equal(FLOW_PERSPECTIVE, 1.92)
  assert.equal(FLOW_VANISH_Y, .16)
  assert.ok(Math.abs(FLOW_OVERLAP - .071) < .002, 'actual projected inner edge is hidden 7% by the center')
  const left = flowProjectedCorners(-1)
  const right = flowProjectedCorners(1)
  const expected = [
    ['outside top x', left.topLeft.x, -1.067],
    ['outside top y', left.topLeft.y, -.447],
    ['outside bottom y', left.bottomLeft.y, .473],
    ['inside top x', left.topRight.x, -.429],
    ['inside top y', left.topRight.y, -.269],
    ['inside bottom y', left.bottomRight.y, .381],
    ['opposite outside top x', right.topRight.x, 1.067],
    ['opposite inside top x', right.topLeft.x, .429],
  ]
  for (const [label, actual, target] of expected) {
    assert.ok(Math.abs(actual - target) < .004, label + ': ' + actual + ' != ' + target)
  }
  assert.ok(left.topRight.x > -.5 && right.topLeft.x < .5, 'both inner edges are behind the main image')
  assert.ok(left.topLeft.y < left.topRight.y, 'visible upper triangular wedge rises toward the outside')
  assert.ok(left.bottomLeft.y > left.bottomRight.y, 'visible lower triangular wedge falls toward the outside')
  assert.ok(left.bottomLeft.y - left.topLeft.y > left.bottomRight.y - left.topRight.y,
    'outer edge is taller than inner edge')
  assert.ok(Math.abs(left.topLeft.x + right.topRight.x) < 1e-8, 'perfect left/right symmetry')
  assert.equal(flowCoverGeometry(1, 220).pivot, 50, 'rotate the panel about center for proper perspective')
  assert.equal(flowCoverGeometry(1, 220).angle, -60)
  assert.equal(flowCoverGeometry(-1, 220).angle, 60)
  assert.equal(FLOW_SPRING.stiffness, 135)
  assert.equal(FLOW_SPRING.damping, 24)
  assert.equal(FLOW_SPRING.mass, 1)
})

test('overlapping neighbor spacing is smooth across both center and first-neighbor boundaries', () => {
  const size = 220
  const epsilon = 0.0001
  const x0 = flowCoverGeometry(1, size).x
  const before = (x0 - flowCoverGeometry(1 - epsilon, size).x) / (size * epsilon)
  const after = (flowCoverGeometry(1 + epsilon, size).x - x0) / (size * epsilon)
  assert.ok(Math.abs(before - after) < .001, 'no sudden jump in swipe velocity')
  const first = flowCoverGeometry(0, size).x
  const beforeCenter = (first - flowCoverGeometry(-epsilon, size).x) / (size * epsilon)
  const afterCenter = (flowCoverGeometry(epsilon, size).x - first) / (size * epsilon)
  assert.ok(Math.abs(beforeCenter - afterCenter) < .001, 'inset applies continuously as cover leaves center')
  // The nearest panel increasingly retreats behind the center as it turns,
  // rather than jumping there when its index rounds to the next item.
  for (const d of [.1, .25, .5, .75, .9, 1]) {
    const g = flowCoverGeometry(d, size)
    const mirror = flowCoverGeometry(-d, size)
    assert.ok(Math.abs(g.x + mirror.x) < 1e-9, 'left/right geometric symmetry')
    assert.ok(g.depth <= 0, 'neighbor stays behind facing artwork')
  }
  assert.equal(flowCoverGeometry(-1, size).angle, 60)
  assert.equal(flowCoverGeometry(1, size).angle, -60)
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
  assert.ok(!flow.includes('WebkitBoxReflect'), 'Cover Flow must not render any reflection')
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

test('Cover Flow artwork cannot be dragged as an image file', () => {
  assert.ok(flow.includes('src={thumbnail} draggable={false} loading="eager" decoding="async"'))
  assert.ok(flow.includes('src={full} draggable={false} loading="eager" decoding="async"'))
  assert.ok(flow.includes('onDragStart={e => e.preventDefault()}'), 'suppress browser drag image preview')
  assert.ok(flow.includes('onPointerDown={down} onPointerMove={move} onPointerUp={up}'), 'keep gesture-controlled movement')
})

test('Cover Flow keeps its perspective stage without any reflected artwork', () => {
  assert.ok(flow.includes('transformOrigin: origin'), 'the artwork pivot interpolates with drag')
  assert.ok(flow.includes('origin = useTransform(geometry'), 'pivot uses a single per-frame geometry value')
  assert.ok(!flow.includes('WebkitBoxReflect'), 'no CSS mirror exists even in full 3D')
  assert.ok(!flow.includes('scaleY(-1)'), 'no second mirrored-image layer exists')
  assert.ok(flow.includes('bg-black'), 'the Cover Flow stage remains black')
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

test('the calibrated corner projection fits the reflection-free stage even while scrolling', () => {
  assert.ok(flow.includes('top: size * 0.18'))
  assert.ok(flow.includes('height: size * 1.36'))
  for (const d of [-4, -3, -2, -1, -.75, -.5, 0, .5, .75, 1, 2, 3, 4]) {
    const corners = flowProjectedCorners(d)
    for (const corner of Object.values(corners)) {
      const stageY = .18 + .5 + corner.y
      assert.ok(stageY > 0 && stageY < 1.36, 'cover edge must fit stage at ' + d + ': ' + stageY)
    }
  }
  assert.ok(flow.includes('overflow-hidden bg-black'), 'no cover overflow or reflected copy')
  assert.ok(flow.includes('translateY('), 'vanishing point is shifted below center like the model')
  assert.ok(flow.includes('FLOW_PERSPECTIVE'), 'CSS uses the same measured perspective as numeric test')
  assert.ok(!flow.includes('WebkitBoxReflect'), 'desktop remains reflection-free')
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

test('fast multi-cover animation does not mount/decode full-resolution art on every index', () => {
  assert.ok(flow.includes('const FlowCover = React.memo('), 'reuse cover subtrees across selection changes')
  assert.ok(flow.includes('const geometry = useTransform(position'), 'calculate perspective geometry once per frame')
  assert.ok(flow.includes('useTransform(geometry, g => g.pivot'), 'derive the pivot from cached geometry')
  assert.ok(flow.includes('useTransform(geometry, g => g.opacity'), 'derive opacity from cached geometry')
  assert.ok(flow.includes('highRes={settled && index === activeIndex}'), 'full resolution only at rest')
  assert.ok(flow.includes('setSettled(false)'), 'drag and coast disable full-resolution extraction')
  assert.ok(flow.includes('onComplete: () => setSettled(true)'), 'full resolution resumes after the animation')
  assert.ok(flow.includes('const image = new Image()'), 'decode full artwork off DOM')
  assert.ok(flow.includes('if (live) setDecoded(full)'), 'only display the decoded full cover')
  assert.ok(flow.includes('src={thumbnail}'), 'small artwork stays visible underneath full art')
})

test('fast-flip window avoids repeated React and image work without a reflection', () => {
  assert.ok(flow.includes('Math.abs(next - renderCenterRef.current) >= 4'), 'shift mount window in batches')
  assert.ok(flow.includes('if (next !== activeRef.current)'), 'skip unchanged frame-driven React updates')
  assert.ok(flow.includes('flowVisibleRange(renderCenter, count)'), 'window is not recalculated around every new index')
  assert.ok(flow.includes('onSelect={handleSelect} onPlay={handlePlay} onContextMenu={handleMenu}'), 'stable callbacks keep React.memo effective')
  assert.ok(!flow.includes('WebkitBoxReflect'), 'fast covers never create a mirrored layer')
  assert.ok(!flow.includes('scaleY(-1)'), 'no duplicate image used to draw mirrored artwork')
  assert.ok(flow.includes("window.requestIdleCallback?.(warmNext)"), 'prefetch decoding runs in idle time')
  assert.ok(flow.includes('await image.decode?.()'), 'warm thumbnails asynchronously')
  assert.ok(flow.includes("willChange: reduced ? 'auto' : 'transform'"), 'promote moving covers')
  assert.deepEqual(flowVisibleRange(8, 24), {start: 1, end: 16})
})

test('reflection implementation and its Home-specific paint layering are completely removed', () => {
  assert.ok(!/reflecti(on|ve)|WebkitBoxReflect|box-reflect/i.test(flow) && !flow.includes('scaleY(-1)'), 'no reflection code remains')
  assert.ok(!flow.includes('overflow-y-visible'), 'artwork remains inside the stage')
  assert.ok(!flow.includes('height: size * 1.54'), 'remove reflection-only stage height')
  assert.ok(!shelf.includes('className="relative z-0"'), 'the shelf no longer needs mirror-tail stacking')
  assert.ok(!home.includes('{mixes.length > 0 && <section className="relative z-10">'), 'mixes no longer need mirror-tail stacking')
  assert.ok(!home.includes('{suggestions.length > 0 && <section className="relative z-10">'), 'suggestions no longer need mirror-tail stacking')
  assert.ok(!home.includes('{recentTracks.length > 0 && <section className="relative z-10">'), 'recent tracks no longer need mirror-tail stacking')
  assert.ok(flow.includes('onPointerDown={down} onPointerMove={move} onPointerUp={up}'), 'drag mechanics remain intact')
})

test('fractional drags select the nearest rendered cover center, not rounded inverse index', () => {
  const width = 960, size = 220, center = width / 2, count = 24
  const projected = d => {
    const g = flowCoverGeometry(d, 1)
    return g.x / (1 - g.depth / FLOW_PERSPECTIVE)
  }
  for (const position of [2.1, 4.25, 8.49, 10.75, 15.9]) {
    for (const index of [Math.floor(position) - 1, Math.floor(position),
                          Math.ceil(position), Math.ceil(position) + 1]) {
      if (index < 0 || index >= count) continue
      const x = center + size * projected(index - position)
      assert.equal(flowIndexAt(x, width, size, position, count), index,
        `cover ${index} must select at its painted center when position=${position}`)
      if (index + 1 >= count) continue
      const nextX = center + size * projected(index + 1 - position)
      const midpoint = (x + nextX) / 2
      assert.equal(flowIndexAt(midpoint - .05, width, size, position, count), index,
        'left of actual projected-center midpoint selects left artwork')
      assert.equal(flowIndexAt(midpoint + .05, width, size, position, count), index + 1,
        'right of actual projected-center midpoint selects right artwork')
    }
  }
  assert.equal(flowIndexAt(center, width, size, .5, count), 0,
    'equal-distance tie chooses the earlier cover deterministically')
})

test('hit testing inverts the actual projected centers, not the retired hinge estimate', () => {
  const stage = 1000, size = 220, center = stage / 2, pos = 6
  const actualCenter = d => {
    const geo = flowCoverGeometry(d, 1)
    return geo.x / (1 - geo.depth / FLOW_PERSPECTIVE)
  }
  for (const d of [0, .5, 1, 2, 3]) {
    const projected = actualCenter(d)
    assert.equal(flowIndexAt(center + size * projected, stage, size, pos, 20), pos + Math.round(d))
    assert.equal(flowIndexAt(center - size * projected, stage, size, pos, 20), pos - Math.round(d))
  }
  assert.equal(flowIndexAt(center + size * 1.06, stage, size, pos, 20, true), pos + 1)
  assert.ok(flow.includes('100 - Math.round(Math.abs(index - p) * 10)'),
    'selected artwork draws in front of both side panels')
  assert.ok(flow.includes("transformStyle: 'preserve-3d'"))
})
