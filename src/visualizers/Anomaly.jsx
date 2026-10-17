// The side panel's "Anomaly": a glowing wireframe sphere, its surface
// rippling with noise and swelling with the music, turning faster on loud
// parts, inside three rings drawn from the spectrum (bass inside, highs
// outside). filipz's "Audio Visualizer with THREEJS" pen without its HUD,
// particles and space backdrop. three.js is loaded only when it's shown.
//   sensitivity   1-10 as in the pen (5: the pen's default)
//   size          0.5-2, how big against the panel (1: about half its width)
//   color         #rrggbb ('accent': the accent colour)
//
// The canvas fills its box, under the floating player bar too; the sphere is
// centred in the part above it (--player-space), like the round character.

import React, { useEffect, useRef } from 'react'
import { getAnalyser, pickColor, useAnalyserVersion } from './audio'

export const ANOMALY_COLOR = '#ff4e42'

// Ashima's 3D simplex noise, as in the pen.
const NOISE = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`

const SHELL_VERTEX = `
uniform float time;
uniform float audioLevel;
varying vec3 vNormal;
varying vec3 vPosition;
${NOISE}
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec3 pos = position;
  float noise = snoise(vec3(position.xy * 0.5, position.z * 0.5 + time * 0.3));
  pos += normal * noise * 0.2 * (1.0 + audioLevel);
  vPosition = pos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`
const SHELL_FRAGMENT = `
uniform float time;
uniform vec3 color;
uniform float audioLevel;
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vec3 viewDirection = normalize(cameraPosition - vPosition);
  float fresnel = pow(1.0 - max(0.0, dot(viewDirection, vNormal)), 2.0 + audioLevel * 2.0);
  float pulse = 0.8 + 0.2 * sin(time * 2.0);
  gl_FragColor = vec4(color * fresnel * pulse * (1.0 + audioLevel * 0.8), fresnel * (0.7 - audioLevel * 0.3));
}
`
const GLOW_VERTEX = `
uniform float audioLevel;
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = position * (1.0 + audioLevel * 0.2);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosition, 1.0);
}
`
const GLOW_FRAGMENT = `
uniform vec3 color;
uniform float time;
uniform float audioLevel;
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vec3 viewDirection = normalize(cameraPosition - vPosition);
  float fresnel = pow(1.0 - max(0.0, dot(viewDirection, vNormal)), 3.0 + audioLevel * 3.0);
  float pulse = 0.5 + 0.5 * sin(time * 2.0);
  float audioFactor = 1.0 + audioLevel * 3.0;
  gl_FragColor = vec4(color * fresnel * (0.8 + 0.2 * pulse) * audioFactor, fresnel * 0.3 * audioFactor * (1.0 - audioLevel * 0.2));
}
`

const RADIUS = 2
const CAMERA_Z = 10
const FOV = 60

const rgba = (hex, alpha) => `rgba(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')},${alpha})`
// A lighter and a darker shade of the colour, for the rings (the pen's three reds).
const shade = (hex, amount) => '#' + [1, 3, 5].map(i => {
  const v = parseInt(hex.slice(i, i + 2), 16)
  return Math.round(amount > 0 ? v + (255 - v) * amount : v * (1 + amount)).toString(16).padStart(2, '0')
}).join('')

/** The pen's circular visualizer: three rings bulging out with the spectrum. */
function drawRings(ctx, data, width, height, sphereRadius, sensitivity, color) {
  ctx.clearRect(0, 0, width, height)
  if (!data) return
  const cx = width / 2
  const cy = height / 2
  const baseRadius = sphereRadius * 1.15
  const light = shade(color, 0.55)
  const dark = shade(color, -0.25)
  const stops = [[color, dark], [dark, light], [light, color]]
  ctx.beginPath()
  ctx.arc(cx, cy, baseRadius * 1.2, 0, Math.PI * 2)
  ctx.fillStyle = rgba(color, 0.05)
  ctx.fill()
  const points = 180
  const rings = 3
  for (let ring = 0; ring < rings; ring++) {
    const ringRadius = baseRadius * (0.7 + ring * 0.15)
    const opacity = 0.8 - ring * 0.2
    const start = Math.floor((ring * data.length) / (rings * 1.5))
    const end = Math.floor(((ring + 1) * data.length) / (rings * 1.5))
    const range = Math.max(1, end - start)
    ctx.beginPath()
    for (let i = 0; i < points; i++) {
      // Our spectrum has fewer bins than points: each point reads between two.
      const pos = start + (i / points) * range
      const bin = Math.floor(pos)
      const value = (data[bin] + ((data[Math.min(end, bin + 1)] ?? data[bin]) - data[bin]) * (pos - bin)) / 255
      const radius = ringRadius * (1 + value * (sensitivity / 5) * 0.5)
      const angle = (i / points) * Math.PI * 2
      const x = cx + Math.cos(angle) * radius
      const y = cy + Math.sin(angle) * radius
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    const gradient = ctx.createRadialGradient(cx, cy, ringRadius * 0.8, cx, cy, ringRadius * 1.2)
    gradient.addColorStop(0, rgba(stops[ring][0], opacity))
    gradient.addColorStop(1, rgba(stops[ring][1], opacity * 0.7))
    ctx.strokeStyle = gradient
    ctx.lineWidth = 2 + (rings - ring)
    ctx.shadowBlur = ring ? 15 : 0
    ctx.shadowColor = rgba(color, 0.7)
    ctx.stroke()
  }
  ctx.shadowBlur = 0
}

export default function Anomaly({ sensitivity = 5, size = 1, color = ANOMALY_COLOR, className = '' }) {
  const wrapRef = useRef(null)
  const ringsRef = useRef(null)
  const sceneRef = useRef(null)
  const analyserVersion = useAnalyserVersion()
  const settingsRef = useRef({ sensitivity, size, color })
  settingsRef.current = { sensitivity, size, color }

  useEffect(() => {
    const wrap = wrapRef.current
    const ringsCanvas = ringsRef.current
    const sceneCanvas = sceneRef.current
    if (!wrap || !ringsCanvas || !sceneCanvas) return undefined
    let cancelled = false
    let cleanup = () => {}

    import('three').then((THREE) => {
      if (cancelled) return
      const renderer = new THREE.WebGLRenderer({ canvas: sceneCanvas, antialias: true, alpha: true })
      renderer.setClearColor(0x000000, 0)
      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100)
      camera.position.set(0, 0, CAMERA_Z)
      const tint = new THREE.Color(ANOMALY_COLOR)
      const shellMaterial = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, color: { value: tint }, audioLevel: { value: 0 } },
        vertexShader: SHELL_VERTEX, fragmentShader: SHELL_FRAGMENT, wireframe: true, transparent: true,
      })
      const glowMaterial = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, color: { value: tint }, audioLevel: { value: 0 } },
        vertexShader: GLOW_VERTEX, fragmentShader: GLOW_FRAGMENT,
        transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
      })
      const shellGeometry = new THREE.IcosahedronGeometry(RADIUS, 4)
      const glowGeometry = new THREE.SphereGeometry(RADIUS * 1.2, 32, 32)
      const anomaly = new THREE.Group()
      anomaly.add(new THREE.Mesh(shellGeometry, shellMaterial))
      anomaly.add(new THREE.Mesh(glowGeometry, glowMaterial))
      scene.add(anomaly)

      const ctx = ringsCanvas.getContext('2d')
      let box = { width: 1, height: 1, dpr: 1 }
      const resize = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const width = Math.max(1, sceneCanvas.clientWidth)
        const height = Math.max(1, sceneCanvas.clientHeight)
        box = { width, height, dpr }
        renderer.setPixelRatio(dpr)
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        ringsCanvas.width = Math.round(width * dpr)
        ringsCanvas.height = Math.round(height * dpr)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      resize()
      const observer = new ResizeObserver(resize)
      observer.observe(sceneCanvas)

      const analyser = getAnalyser()
      const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
      const clock = new THREE.Clock()
      let frame = null
      const draw = () => {
        frame = requestAnimationFrame(draw)
        const { sensitivity: sens, size: scale, color: picked } = settingsRef.current
        const hex = pickColor(picked, ANOMALY_COLOR)
        tint.set(hex)
        const time = clock.getElapsedTime()
        let level = 0
        if (analyser) {
          analyser.getByteFrequencyData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) sum += data[i]
          level = (sum / data.length / 255) * sens / 5
        }
        // The pen's sphere is sized for a wide screen: here it fits the
        // smaller side of the panel, times the size setting.
        const { width, height } = box
        const fit = (Math.min(width, height) / height) * 1.5 * scale
        anomaly.scale.setScalar(fit)
        const sphereRadius = (RADIUS * fit / (CAMERA_Z * Math.tan((FOV / 2) * Math.PI / 180))) * (height / 2)
        drawRings(ctx, data, width, height, sphereRadius, sens, hex)
        shellMaterial.uniforms.time.value = time
        shellMaterial.uniforms.audioLevel.value = level
        glowMaterial.uniforms.time.value = time
        glowMaterial.uniforms.audioLevel.value = level
        const spin = 1 + level
        anomaly.rotation.y += 0.005 * spin
        anomaly.rotation.z += 0.002 * spin
        renderer.render(scene, camera)
      }
      frame = requestAnimationFrame(draw)
      cleanup = () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        shellGeometry.dispose()
        glowGeometry.dispose()
        shellMaterial.dispose()
        glowMaterial.dispose()
        renderer.dispose()
      }
    }).catch(error => console.warn('[anomaly] Could not load three.js:', error))

    return () => { cancelled = true; cleanup() }
  }, [analyserVersion])

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${className}`}>
      <div className="absolute inset-x-0 top-0" style={{ bottom: 'var(--player-space, 0px)' }}>
        <canvas ref={ringsRef} aria-hidden="true" className="absolute inset-0 block h-full w-full" />
        <canvas ref={sceneRef} aria-hidden="true" className="absolute inset-0 block h-full w-full" />
      </div>
    </div>
  )
}
