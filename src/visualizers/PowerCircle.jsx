// The side panel's Visualization tab: PowerAudio's "innovative audio
// visualizer" (cssscript.com/innovative-audio-visualizer-power), redrawn on a
// 2D canvas instead of pixi.js. A face whose outline is the waveform pulses
// with the loudness, wanders and spins on the beat; dots drift around it,
// pulled towards it, and the background flashes on loud parts. Sizes in the
// original were for a full-screen page: here they scale with the panel.
//
// It only runs while mounted (the tab is showing, or no lyrics were found).
// When the music is quiet or paused it doesn't freeze: it breathes, sways and
// wobbles a little on its own (see calmFloor).
//
// The canvas fills its box, under the floating player bar too; the face is
// centred in the part above it (--player-space).

import React, { useEffect, useRef } from 'react'
import { createLoudness } from './audio'

const TAU = Math.PI * 2

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// Moves by its forces, slowed by friction (the original's DisplayObject).
function makeBody(x, y) {
  return { position: { x, y }, velocity: { x: 0, y: 0 }, forces: new Map(), friction: 1, mass: 1 }
}
function stepBody(body, dt) {
  let ax = -body.friction * body.velocity.x
  let ay = -body.friction * body.velocity.y
  for (const force of body.forces.values()) { ax += force.x; ay += force.y }
  body.velocity.x += dt * ax / body.mass
  body.velocity.y += dt * ay / body.mass
  body.position.x += dt * body.velocity.x
  body.position.y += dt * body.velocity.y
}

// What the scene moves with: the real loudness, but never less than a gentle
// made-up one, so a quiet or paused song still leaves it alive. The made-up
// part fades out as the music gets louder.
function calmFloor(loud, feel, now) {
  const calm = 1 - Math.min(1, loud.averageGain / 0.05)
  const breathe = 0.5 + 0.5 * Math.sin(now / 900)
  feel.averageGain = Math.max(loud.averageGain, calm * 0.03)
  feel.firstOrder = Math.max(loud.firstOrder, calm * (0.05 + 0.03 * breathe))
  feel.linearized = Math.max(loud.linearized, calm * (0.03 + 0.02 * breathe))
  const wobble = calm * 0.05
  for (let i = 0; i < feel.smooth.length; i++) {
    feel.smooth[i] = Math.max(loud.smooth[i], wobble * (0.5 + 0.5 * Math.sin(i * 0.18 + now / 350)))
  }
  return feel
}

function makeScene(width, height, inset = 0) {
  const seen = Math.max(1, height - inset)
  const baseRadius = Math.min(width, seen) / 7
  // The original's pixel sizes were made for a radius of about 80.
  const scale = Math.max(0.4, Math.min(1.5, baseRadius / 80))
  const circle = {
    ...makeBody(width / 2, seen / 2),
    baseRadius, scale, center: { x: width / 2, y: seen / 2 }, target: { x: width / 2, y: seen / 2 },
    radius: baseRadius, lineWidth: 1, blur: 0, eyesClosed: false,
    rotation: 0, rotationVelocity: 0, targetRotation: 0, targetBaseRotation: 0,
    randomAngle: 0, lastRandomPosition: 0, lastRandomRotation: 0,
  }
  const nodes = []
  const spacing = Math.max(80, Math.min(200, Math.min(width, height) / 3))
  let id = 0
  for (let x = 10; x < width; x += spacing) {
    for (let y = 10; y < height; y += spacing) {
      const node = makeBody(x + 12 * Math.random(), y + 12 * Math.random())
      node.id = id++
      node.radius = (2 + 4 * Math.random()) * Math.max(0.6, scale)
      node.color = `#${Math.floor(0xffffff * (0.5 * Math.random() + 0.5)).toString(16).padStart(6, '0')}`
      nodes.push(node)
    }
  }
  return { width, height, circle, nodes }
}

function resizeScene(scene, width, height, inset = 0) {
  const { circle } = scene
  const seen = Math.max(1, height - inset)
  scene.width = width
  scene.height = height
  circle.baseRadius = Math.min(width, seen) / 7
  circle.scale = Math.max(0.4, Math.min(1.5, circle.baseRadius / 80))
  circle.center = { x: width / 2, y: seen / 2 }
}

function updateScene(scene, loud, dt, pointer, now) {
  const { circle, nodes, width, height } = scene
  const k = circle.scale

  // The face: grows and thickens with the loudness, sharp when loud and
  // blurred when quiet, pulled towards a point that jumps about on the beat.
  circle.eyesClosed = Math.floor(10 * now / 1000) % 30 === 0
  circle.lineWidth = 1 + 8 * loud.linearized * k
  circle.blur = Math.floor(0.2 + 4 * Math.exp(-24 * loud.linearized))
  circle.radius = circle.baseRadius + 100 * loud.linearized * k
  if (now > circle.lastRandomPosition + 800) { circle.randomAngle = Math.random() * TAU; circle.lastRandomPosition = now }
  if (now > circle.lastRandomRotation + 1400) {
    circle.targetRotation = 2 * loud.firstOrder * (Math.random() - 0.5)
    if (Math.random() < 0.05 && loud.firstOrder >= 0.25) circle.targetBaseRotation -= TAU
    circle.lastRandomRotation = now
  }
  let rotationAcceleration = (circle.targetRotation + circle.targetBaseRotation - circle.rotation) * loud.firstOrder * 16
  rotationAcceleration += 2 * -circle.rotationVelocity
  circle.rotationVelocity += rotationAcceleration * dt
  circle.rotation += circle.rotationVelocity * dt
  const reach = 256 * loud.firstOrder * k
  let tx = circle.center.x + Math.cos(circle.randomAngle) * reach
  let ty = circle.center.y + Math.sin(circle.randomAngle) * reach
  if (pointer) {
    // Leans towards the mouse, as far as the beat lets it.
    const toward = Math.min(reach, distance(pointer, circle.position))
    const angle = Math.atan2(pointer.y - circle.position.y, pointer.x - circle.position.x)
    tx += Math.cos(angle) * toward
    ty += Math.sin(angle) * toward
  }
  circle.target = { x: tx, y: ty }
  circle.forces.set('main', {
    x: (circle.target.x - circle.position.x) * loud.firstOrder * 16,
    y: (circle.target.y - circle.position.y) * loud.firstOrder * 16,
  })
  stepBody(circle, dt)

  // The dots: drawn towards the face, towards each other when close.
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    const angle = Math.atan2(a.position.y - circle.position.y, a.position.x - circle.position.x)
    const d = Math.max(1, distance(a.position, circle.position))
    a.forces.set('center', { x: 1e5 * -Math.cos(angle) / d, y: 1e5 * -Math.sin(angle) / d })
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      const between = distance(a.position, b.position)
      if (between > 300) { a.forces.delete(b.id); b.forces.delete(a.id); continue }
      const h = Math.atan2(a.position.y - b.position.y, a.position.x - b.position.x)
      const u = between ? 1e4 * Math.cos(h) / between : 0
      const l = between ? 1e4 * Math.sin(h) / between : 0
      a.forces.set(b.id, { x: -u, y: -l })
      b.forces.set(a.id, { x: u, y: l })
    }
  }
  // Fast when loud, drifting back when quiet; off one edge, in at the other.
  const pace = Math.max(0.1, 8 * loud.averageGain) - 1
  for (const node of nodes) {
    stepBody(node, dt)
    node.position.x += dt * node.velocity.x * pace
    node.position.y += dt * node.velocity.y * pace
    if (node.position.x < 0) node.position.x = width
    else if (node.position.x > width) node.position.x = 0
    if (node.position.y < 0) node.position.y = height
    else if (node.position.y > height) node.position.y = 0
  }
}

function drawPolygon(ctx, points) {
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.closePath()
}

function drawScene(ctx, scene, loud, background = '#000000') {
  const { circle, nodes, width, height } = scene

  // Background: the chosen colour (black), a little lighter on loud parts.
  const shade = (17 * (Math.min(50, 256 * loud.firstOrder) / 50)) | 0
  const [r, g, b] = [1, 3, 5].map(i => Math.min(255, parseInt(background.slice(i, i + 2), 16) + shade))
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.fillRect(0, 0, width, height)

  // Lines from the dots near the face to its centre.
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.beginPath()
  for (const node of nodes) {
    if (distance(node.position, circle.position) > 2 * circle.radius) continue
    ctx.moveTo(node.position.x, node.position.y)
    ctx.lineTo(circle.position.x, circle.position.y)
  }
  ctx.stroke()

  // The dots: grey when quiet, their own colour when loud, with a ring.
  const grey = (255 * (0.5 + Math.min(8, 64 * loud.averageGain) / 16)) | 0
  for (const node of nodes) {
    const color = loud.averageGain > 0.15 ? node.color : `rgb(${grey},${grey},${grey})`
    const size = node.radius + 4 * loud.firstOrder
    const ring = 6 * size * (1 - Math.exp(-3 * loud.averageGain))
    ctx.globalAlpha = 0.3
    ctx.lineWidth = 4
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.arc(node.position.x, node.position.y, Math.max(0, ring), 0, TAU)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(node.position.x, node.position.y, size, 0, TAU)
    ctx.fill()
  }

  // The face: two outlines made of the waveform (one from its lowest point,
  // one from its mean), mirrored left and right, then the face and its eyes.
  const data = loud.smooth
  let mean = 0
  let min = data[0]
  for (let i = 0; i < data.length; i++) { mean += data[i]; if (data[i] < min) min = data[i] }
  mean /= data.length
  const R = circle.radius
  const pad = 5 * circle.scale
  const outer = []
  const inner = []
  for (let s = 0, a = Math.PI / 2 - 0.5 * Math.PI / data.length; s < data.length; s++, a += Math.PI / data.length) {
    const fromMin = Math.max(0, data[s] - min)
    const fromMean = Math.max(0, data[s] - mean)
    outer.push({ x: Math.cos(a) * (R + R * fromMin), y: Math.sin(a) * (R + R * fromMin) })
    inner.push({ x: Math.cos(a) * (pad + R + R * fromMean), y: Math.sin(a) * (pad + R + R * fromMean) })
  }
  for (let s = data.length - 1; s >= 0; s--) {
    outer.push({ x: -outer[s].x, y: outer[s].y })
    inner.push({ x: -inner[s].x, y: inner[s].y })
  }

  ctx.save()
  ctx.translate(circle.position.x, circle.position.y)
  ctx.rotate(circle.rotation)
  if (circle.blur > 0) ctx.filter = `blur(${circle.blur}px)`
  ctx.lineWidth = circle.lineWidth
  ctx.lineJoin = 'round'
  drawPolygon(ctx, outer)
  ctx.fillStyle = 'rgba(255,255,255,0.02)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.stroke()
  drawPolygon(ctx, inner)
  ctx.fillStyle = 'rgba(255,255,255,0.2)'
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 0, R, 0, TAU)
  ctx.fillStyle = '#111111'
  ctx.fill()
  ctx.stroke()
  const eye = circle.eyesClosed ? 0.02 * R : 0.1 * R
  const eyeY = -0.3 * R
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(-0.5 * eye, eyeY - 0.5 * eye, eye, eye)
  ctx.fillRect(0.3 * R - 0.5 * eye, eyeY - 0.5 * eye, eye, eye)
  ctx.restore()
}

export default function PowerCircle({ className = '', background = '#000000' }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  // Read each frame, so a new colour applies without restarting the scene.
  const backgroundRef = useRef(background)
  backgroundRef.current = /^#[0-9a-f]{6}$/i.test(background) ? background : '#000000'

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const loud = createLoudness(256)
    const feel = { averageGain: 0, firstOrder: 0, linearized: 0, smooth: new Float32Array(256) }
    let scene = null
    let pointer = null
    let frame = null
    let last = 0

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const width = Math.max(1, wrap.clientWidth)
      const height = Math.max(1, wrap.clientHeight)
      const inset = parseFloat(getComputedStyle(wrap).getPropertyValue('--player-space')) || 0
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (!scene) scene = makeScene(width, height, inset)
      else resizeScene(scene, width, height, inset)
      if (!frame) drawScene(ctx, scene, feel, backgroundRef.current)
    }

    const tick = (now) => {
      // A long gap (the window was hidden) is skipped rather than caught up.
      const dt = last ? (now - last) / 1000 : 0
      last = now
      if (dt <= 1) {
        loud.update(dt)
        calmFloor(loud, feel, now)
        updateScene(scene, feel, dt, pointer, now)
      }
      drawScene(ctx, scene, feel, backgroundRef.current)
      frame = requestAnimationFrame(tick)
    }

    const onMove = event => {
      const box = canvas.getBoundingClientRect()
      pointer = { x: event.clientX - box.left, y: event.clientY - box.top }
    }
    const onLeave = () => { pointer = null }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    frame = requestAnimationFrame(tick)
    return () => {
      observer.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 block" />
    </div>
  )
}
