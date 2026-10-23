import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { clampIndex, flowCoverGeometry, flowIndexAt, flowDrag, flowTarget, FLOW_SPRING } from '../src/coverFlowGeometry.mjs'

const shelf = readFileSync(new URL('../src/components/MadeForYou.jsx', import.meta.url), 'utf8')
const flow = readFileSync(new URL('../src/components/CoverFlow.jsx', import.meta.url), 'utf8')
const home = readFileSync(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8')

test('mobile Cover Flow: centre faces forwards; neighbors tilt +/-70° and sink behind', () => {
  const centre = flowCoverGeometry(0, 220)
  assert.equal(centre.angle, 0)
  assert.equal(centre.x, 0)
  assert.equal(centre.depth, 0)
  assert.equal(centre.opacity, 1)
  const right = flowCoverGeometry(1, 220)
  const left = flowCoverGeometry(-1, 220)
  assert.equal(right.angle, -70)
  assert.equal(left.angle, 70)
  assert.ok(Math.abs(right.x - 180.4) < 0.001)
  assert.equal(left.x, -right.x)
  assert.ok(Math.abs(right.depth + 48.4) < 0.001)
  const farther = flowCoverGeometry(2, 220)
  assert.ok(farther.x > right.x && farther.depth < right.depth)
  assert.equal(FLOW_SPRING.stiffness, 170)
  assert.equal(FLOW_SPRING.damping, 26)
  assert.equal(FLOW_SPRING.mass, 1)
})

test('Cover Flow is bounded, rubber-bands at both ends and respects reduced motion', () => {
  assert.equal(clampIndex(-3, 12), 0)
  assert.equal(clampIndex(20, 12), 11)
  assert.equal(flowTarget(10.1, 9, 12), 11)
  assert.equal(flowTarget(0.1, -20, 12), 0)
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
  assert.equal(flowIndexAt(centre + size * 0.82, width, size, 5, 12), 6)
  assert.equal(flowIndexAt(centre - size * 0.82, width, size, 5, 12), 4)
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
