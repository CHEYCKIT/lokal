// The player bar's "Lightning": three glowing lines across the whole bar,
// twitching with the bass, the mids and the highs, and jolting on kicks.
// The lines of filipz's "Music Reactive Shader V3" pen (after shadertoy
// MtVBzG) on plain WebGL, without its background, balls, ripples and grain,
// so the bar shows through.
//   colors     three #rrggbb, one per line (bass, mids, highs)
//   strength   how strongly the music moves them, 1 = as in the pen
//   opacity    0-1

import React, { useEffect, useRef } from 'react'
import { getAnalyser, pickColor, useAnalyserVersion } from './audio'

export const LIGHTNING_COLORS = ['#ff008b', '#c948ff', '#ff94e8']

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

const FRAGMENT = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float lowFreq;
uniform float midFreq;
uniform float highFreq;
uniform float kickEnergy;
uniform float bounceEffect;
uniform float active;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 color3;

const float baseSpeed = 1.0;
const float idleSpeed = 0.1;
const float bassReactivity = 0.4;
const float midReactivity = 0.5;
const float highReactivity = 0.4;
const float kickReactivity = 0.6;
const float bounceIntensity = 0.15;
const float waveIntensity = 0.08;
const float waveComplexity = 2.2;
const float lineThickness = 1.8;
const float lineStraightness = 2.53;
const float idleWaveHeight = 0.01;
// The pen filled a whole screen; in the short player bar its swings are
// stretched up and down this much more, so the lines part and jump.
const float barStretch = 2.6;

float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// How much of a line's colour shows at this distance from it (1 on it).
float glow(float y, float lineY, float thickness) {
  // Never quite 0: right on the line the step below would divide by zero.
  float d = max(1e-4, distance(y, lineY) * (2.0 / thickness));
  return 1.0 - smootherstep(1.0 - clamp(d, 0.0, 1.0), 1.0, 0.99);
}

void main() {
  vec2 p = gl_FragCoord.xy / resolution;
  float t = active;
  float speed = mix(idleSpeed, baseSpeed, t);
  float straightness = mix(1.0, lineStraightness, t);
  float idleWave = idleWaveHeight * sin(p.x * 5.0 + time * 0.2);

  float bassPulse = lowFreq * lowFreq * bassReactivity * t;
  float midPulse = midFreq * midFreq * midReactivity * t;
  float highPulse = highFreq * highFreq * highReactivity * t;
  float kickPulse = kickEnergy * kickEnergy * kickReactivity * 1.5 * t;
  float bounce = bounceEffect * bounceIntensity * t;

  float curve = mix(idleWaveHeight, 0.05 + waveIntensity * (bassPulse + kickPulse * 0.7), t) * sin(6.25 * p.x + speed * time);
  float audioWave = mix(0.0,
    (0.1 * sin(p.x * 20.0 * waveComplexity) * bassPulse +
     0.08 * sin(p.x * 30.0 * waveComplexity) * midPulse +
     0.05 * sin(p.x * 50.0 * waveComplexity) * highPulse) / straightness, t);

  // Line A: the bass and the kicks.
  float aFreq = 40.0 * waveComplexity + 80.0 * bassPulse + 90.0 * kickPulse;
  float aSpeed = 1.5 * speed + 6.0 * bassPulse + 6.0 * kickPulse;
  float aWave = mix(idleWave, (0.01 + 0.05 * bassPulse + 0.1 * kickPulse) / straightness, t);
  float kickWave = kickEnergy > 0.1 ? kickEnergy * 0.3 * sin(15.0 * (p.x - time * 0.5)) * t : 0.0;
  float aOffset = bassPulse * 0.3 * sin(p.x * 10.0 - time * 2.0) + kickWave * 0.7;
  float aY = mix(0.5 + idleWave, 0.5 + curve + audioWave + aWave * sin(aFreq * p.x - aSpeed * time) + aOffset - bounce, t);
  aY = 0.5 + (aY - 0.5) * barStretch;
  float a = glow(p.y, aY, lineThickness * (1.0 + bassPulse * 0.4 + kickPulse * 0.8));
  vec3 aColor = mix(color1, vec3(1.0, 0.7, 0.3), kickEnergy * 0.6 * t);

  // Line B: the mids.
  float bFreq = 50.0 * waveComplexity + 100.0 * midPulse;
  float bSpeed = 2.0 * speed + 8.0 * midPulse;
  float bWave = mix(idleWave * 0.8, (0.01 + 0.05 * midPulse) / straightness, t);
  float bOffset = midPulse * 0.2 * sin(p.x * 15.0 - time * 1.5) + kickEnergy * 0.1 * sin(p.x * 25.0 - time * 3.0) * t;
  float bY = mix(0.5 + idleWave * 0.8, 0.5 + curve - audioWave + bWave * sin(bFreq * p.x + bSpeed * time) * sin(bSpeed * time) + bOffset - bounce * 0.5, t);
  bY = 0.5 + (bY - 0.5) * barStretch;
  float b = glow(p.y, bY, lineThickness * (1.0 + midPulse * 0.3 + kickEnergy * 0.3 * t));
  vec3 bColor = mix(color2, vec3(1.0, 0.5, 0.5), kickEnergy * 0.3 * t);

  // Line C: the highs.
  float cFreq = 60.0 * waveComplexity + 120.0 * highPulse;
  float cSpeed = 2.5 * speed + 10.0 * highPulse;
  float cWave = mix(idleWave * 1.2, (0.01 + 0.05 * highPulse) / straightness, t);
  float cOffset = highPulse * 0.15 * sin(p.x * 20.0 - time);
  float cY = mix(0.5 + idleWave * 1.2, 0.5 + curve * 0.7 - audioWave * 0.5 + cWave * sin(cFreq * p.x + cSpeed * time) * sin(cSpeed * (time + 0.1)) + cOffset - bounce * 0.3, t);
  cY = 0.5 + (cY - 0.5) * barStretch;
  float c = glow(p.y, cY, lineThickness * (1.0 + highPulse * 0.2 + kickEnergy * 0.1 * t));

  // Light on nothing: the colour is its own coverage (premultiplied).
  vec3 light = min(vec3(1.0), aColor * a + bColor * b + color3 * c);
  gl_FragColor = vec4(light, max(light.r, max(light.g, light.b)));
}
`

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)

/**
 * The pen's audio reading: eight bands (by Hz, so it fits our smaller FFT),
 * weighted towards their peaks, with fast attack and slower decay, and kick
 * detection on the kick band's sudden jumps.
 */
function createReader(analyser) {
  const data = new Uint8Array(analyser.frequencyBinCount)
  const binHz = (analyser.context?.sampleRate || 44100) / 2 / data.length
  const bands = [[20, 40], [40, 80], [80, 160], [160, 320], [320, 640], [640, 1280], [1280, 2400], [2400, 8000]]
    .map(([from, to]) => [Math.floor(from / binHz), Math.max(Math.floor(from / binHz) + 1, Math.ceil(to / binHz))])
  const energies = new Float32Array(bands.length)
  const kickHistory = []
  const state = { low: 0, mid: 0, high: 0, kick: 0, bounce: 0 }
  let impact = 0
  let lastKick = 0
  let kicking = false

  const weighted = (from, to) => {
    let sum = 0
    let peak = 0
    let n = 0
    for (let i = from; i < Math.min(to, data.length); i++) {
      const v = data[i] / 255
      peak = Math.max(peak, v)
      sum += Math.pow(v, 1.5)
      n++
    }
    return n ? (sum / n) * 0.7 + peak * 0.3 : 0
  }

  state.update = (strength) => {
    analyser.getByteFrequencyData(data)
    bands.forEach(([from, to], i) => { energies[i] = Math.min(1, weighted(from, to) * strength) })
    const kickNow = energies[1]
    kickHistory.unshift(kickNow)
    if (kickHistory.length > 4) kickHistory.pop()
    const recent = kickHistory.slice(1).reduce((s, v) => s + v, 0) / (kickHistory.length - 1 || 1)
    const now = performance.now()
    if (kickNow - recent > 0.06 && kickNow > 0.15 && (!kicking || now - lastKick > 150)) {
      kicking = true
      state.kick = Math.min(1, kickNow * 2)
      impact = 10
      lastKick = now
    } else {
      state.kick *= 0.8
      if (state.kick < 0.05) kicking = false
      if (impact > 0) impact--
    }
    state.bounce = (impact > 0 ? Math.pow(impact / 10, 0.6) * 0.03 : 0) + state.kick * 0.025
    const follow = (current, target, attack, decay, over = 1.1) =>
      target > current * over ? current * (1 - attack) + target * attack : current * (1 - decay) + target * decay
    state.low = follow(state.low, (energies[1] * 1.2 + energies[2]) / 2.2, 0.7, 0.15)
    state.mid = follow(state.mid, (energies[3] + energies[4]) / 2, 0.6, 0.2)
    state.high = follow(state.high, (energies[5] + energies[6] + energies[7]) / 3, 0.5, 0.2, 1.05)
    state.low = Math.max(state.low, state.kick * 0.6)
  }
  return state
}

export default function Lightning({ isPlaying, colors = LIGHTNING_COLORS, strength = 1, opacity = 1, className = '' }) {
  const canvasRef = useRef(null)
  const analyserVersion = useAnalyserVersion()
  const playingRef = useRef(isPlaying)
  playingRef.current = isPlaying
  const settingsRef = useRef({ colors, strength })
  settingsRef.current = { colors, strength }

  useEffect(() => {
    const canvas = canvasRef.current
    const gl = canvas?.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false })
    if (!gl) return undefined

    const compile = (type, source) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.warn('[lightning]', gl.getShaderInfoLog(shader))
      return shader
    }
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const u = name => gl.getUniformLocation(program, name)
    const uniforms = Object.fromEntries(['resolution', 'time', 'lowFreq', 'midFreq', 'highFreq', 'kickEnergy', 'bounceEffect', 'active', 'color1', 'color2', 'color3'].map(n => [n, u(n)]))

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr))
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr))
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const analyser = getAnalyser()
    const reader = analyser ? createReader(analyser) : null
    let active = 0
    let time = 0
    let last = 0
    let frame = null
    const draw = (now) => {
      frame = requestAnimationFrame(draw)
      // 30 frames a second, like the other player bar visualizations; 15
      // while it only idles (paused, the lines barely sway).
      if (now - last < 1000 / (active > 0 || playingRef.current ? 30 : 15) - 1) return
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      const playing = playingRef.current && !!reader
      const { colors: lineColors, strength: power } = settingsRef.current
      // Eases into and out of the music, like the pen (its 0.03 a frame at 60 fps).
      active = Math.max(0, Math.min(1, active + (playing ? 1 : -1) * dt * 1.8))
      time += dt * 0.6
      if (playing) reader.update(power)
      else if (reader && active === 0) Object.assign(reader, { low: 0, mid: 0, high: 0, kick: 0, bounce: 0 })
      const r = reader || { low: 0, mid: 0, high: 0, kick: 0, bounce: 0 }
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height)
      gl.uniform1f(uniforms.time, time)
      gl.uniform1f(uniforms.lowFreq, r.low)
      gl.uniform1f(uniforms.midFreq, r.mid)
      gl.uniform1f(uniforms.highFreq, r.high)
      gl.uniform1f(uniforms.kickEnergy, r.kick)
      gl.uniform1f(uniforms.bounceEffect, r.bounce)
      gl.uniform1f(uniforms.active, active)
      lineColors.forEach((hex, i) => gl.uniform3fv(uniforms[`color${i + 1}`], hexToRgb(pickColor(hex, LIGHTNING_COLORS[i]))))
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [analyserVersion])

  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={{ display: 'block', width: '100%', height: '100%', opacity }} />
}
