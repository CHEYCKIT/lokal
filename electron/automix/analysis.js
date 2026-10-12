// What AutoMix needs to know about a song, from its decoded audio (mono,
// RATE Hz): where the sound starts and really ends (silence and long fades
// trimmed), where its fade-out begins, how loud it is, its tempo and where the
// beats fall, and its key. Pure functions, so they run in a worker thread
// (worker.js) and in the tests.
//
// Tempo: an onset envelope (rises in short-time energy of the signal's first
// difference, which favours drums over held notes), autocorrelated over 60–200
// BPM with a preference for ~120 (the octave errors every tempo tracker makes
// go the musical way), then the beat grid's phase by comb sum.
// Key: a chromagram from FFTs, matched against the Krumhansl–Kessler major and
// minor profiles in all twelve keys.

const RATE = 11025
const VERSION = 1

// ---------------------------------------------------------------- loudness

/** RMS over `hop`-second frames. */
function envelope(pcm, rate = RATE, hop = 0.05) {
  const size = Math.max(1, Math.round(rate * hop))
  const frames = Math.floor(pcm.length / size)
  const out = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let i = f * size, end = i + size; i < end; i++) sum += pcm[i] * pcm[i]
    out[f] = Math.sqrt(sum / size)
  }
  return out
}

const db = value => 20 * Math.log10(Math.max(value, 1e-9))

function percentile(values, p) {
  if (!values.length) return 0
  const sorted = Float32Array.from(values).sort()
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))]
}

/**
 * Where the sound starts and ends, and where the outro fades: seconds.
 * "Audible" is within 40 dB of the song's loud parts (its 90th percentile).
 */
function edges(env, hop = 0.05) {
  const duration = env.length * hop
  if (env.length < 4) return { leadIn: 0, audibleEnd: duration, fadeOutStart: duration, loudness: -60, energy: 0 }
  const loud = percentile(env, 0.9)
  const floor = loud * 0.01 // -40 dB
  let first = 0
  while (first < env.length && env[first] <= floor) first++
  let last = env.length - 1
  while (last > first && env[last] <= floor) last--
  // The outro's fade: from the end back while the sound stays under half the
  // song's typical level (-6 dB of its median), with 1 s of slack for gaps.
  const typical = percentile(env.subarray(first, last + 1), 0.5)
  let fade = last
  let slack = 0
  while (fade > first) {
    if (env[fade] < typical * 0.5) { fade--; slack = 0; continue }
    if (++slack > 1 / hop) break
    fade--
  }
  fade = Math.min(last, fade + Math.round(1 / hop))
  let sum = 0
  for (let i = first; i <= last; i++) sum += env[i] * env[i]
  const rms = Math.sqrt(sum / Math.max(1, last - first + 1))
  return {
    leadIn: first * hop,
    audibleEnd: Math.min(duration, (last + 1) * hop),
    fadeOutStart: fade * hop,
    loudness: db(rms),
    // 0 (quiet, about -30 dBFS RMS) to 1 (loud, about -8): how hard the song hits.
    energy: Math.min(1, Math.max(0, (db(rms) + 30) / 22)),
    // The first and last 8 seconds' loudness against the whole: a soft intro or outro.
    intro: db(rmsOf(env, first, first + Math.round(8 / hop))) - db(rms),
    outro: db(rmsOf(env, Math.max(first, last - Math.round(8 / hop)), last)) - db(rms),
  }
}

function rmsOf(env, from, to) {
  let sum = 0
  let n = 0
  for (let i = Math.max(0, from); i <= Math.min(env.length - 1, to); i++) { sum += env[i] * env[i]; n++ }
  return Math.sqrt(sum / Math.max(1, n))
}

// ---------------------------------------------------------------- tempo

const ONSET_HOP = 256 // about 23 ms at RATE

/**
 * Onset strength per ONSET_HOP frame: positive rises in log energy, of the
 * signal as it is (kicks, bass) and of its first difference (snares, hats),
 * each normalised (the low band weighted by `lowWeight`).
 */
function onsets(pcm, lowWeight = 1) {
  const frames = Math.floor(pcm.length / ONSET_HOP)
  const low = new Float32Array(frames)
  const high = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sumLow = 0
    let sumHigh = 0
    for (let i = f * ONSET_HOP + 1, end = (f + 1) * ONSET_HOP; i < end; i++) {
      sumLow += pcm[i] * pcm[i]
      const d = pcm[i] - pcm[i - 1]
      sumHigh += d * d
    }
    low[f] = Math.log1p(1000 * sumLow / ONSET_HOP)
    high[f] = Math.log1p(1000 * sumHigh / ONSET_HOP)
  }
  const rise = values => {
    const out = new Float32Array(frames)
    let total = 0
    for (let f = 1; f < frames; f++) { out[f] = Math.max(0, values[f] - values[f - 1]); total += out[f] }
    const mean = total / Math.max(1, frames)
    if (mean > 0) for (let f = 0; f < frames; f++) out[f] /= mean
    return out
  }
  const a = rise(low)
  const b = rise(high)
  const out = new Float32Array(frames)
  for (let f = 0; f < frames; f++) out[f] = lowWeight * a[f] + b[f]
  // Take away the local mean, so steady loud passages don't read as beats.
  const half = 8
  const smooth = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    let n = 0
    for (let k = Math.max(0, f - half); k <= Math.min(frames - 1, f + half); k++) { sum += out[k]; n++ }
    smooth[f] = Math.max(0, out[f] - sum / n)
  }
  // Each onset widened a little (a 5-frame triangle): a beat period that
  // falls between two frames still lines peaks up when correlated.
  const wide = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let k = -2; k <= 2; k++) sum += (smooth[f + k] || 0) * (3 - Math.abs(k))
    wide[f] = sum / 9
  }
  return wide
}

/**
 * Tempo (BPM), confidence (0–1) and the first beat (s), from an onset
 * envelope; the beat grid's phase from `phaseOnset` when given (one that
 * favours kicks: they mark the beat in most music, where hats and snares
 * often sit between).
 */
function tempo(onset, rate = RATE, phaseOnset = onset) {
  const fps = rate / ONSET_HOP
  const minLag = Math.floor(fps * 60 / 200)
  const maxLag = Math.ceil(fps * 60 / 60)
  if (onset.length < maxLag * 4) return { bpm: null, confidence: 0, beat: 0 }
  const score = new Float32Array(maxLag + 1)
  let total = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = lag; i < onset.length; i++) sum += onset[i] * onset[i - lag]
    score[lag] = sum
    total += sum
  }
  const mean = total / Math.max(1, maxLag - minLag + 1)
  // A preference for tempos near 120 BPM (log-Gaussian, an octave wide).
  const weight = lag => Math.exp(-0.5 * (Math.log2((60 * fps / lag) / 120) / 0.9) ** 2)
  const acf = lag => {
    if (lag <= maxLag) return score[lag] || 0
    let sum = 0
    for (let i = lag; i < onset.length; i++) sum += onset[i] * onset[i - lag]
    return sum
  }
  // A beat repeats every period and every two: a period scores with its
  // double, so a pattern's off-beats (a 3:2 reading) don't win.
  let best = minLag
  let bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    const value = (score[lag] + 0.5 * acf(2 * lag)) * weight(lag)
    if (value > bestScore) { bestScore = value; best = lag }
  }
  // Slow, with something just as regular at half the period: the beat is that (an octave up).
  const half = Math.round(best / 2)
  if (60 * fps / best < 90 && half >= minLag && score[half] >= 0.6 * score[best]) best = half
  // Sub-frame precision: a parabola through the peak and its neighbours.
  const a = score[best - 1] || 0
  const b = score[best]
  const c = score[best + 1] || 0
  const shift = a - 2 * b + c ? 0.5 * (a - c) / (a - 2 * b + c) : 0
  const coarse = best + Math.max(-0.5, Math.min(0.5, shift))
  // Period and phase together, finely: the comb (one tooth per beat, the whole
  // song long) that collects the most onset. A period a fraction off drifts a
  // whole beat over a few minutes, so this is what puts the grid on the beats.
  let period = coarse
  let phase = 0
  let combBest = -1
  for (let candidate = coarse * 0.985; candidate <= coarse * 1.015; candidate += 0.01) {
    for (let p = 0; p < candidate; p += 0.5) {
      let sum = 0
      for (let t = p; t < phaseOnset.length; t += candidate) sum += phaseOnset[Math.round(t)] || 0
      if (sum > combBest) { combBest = sum; period = candidate; phase = p }
    }
  }
  const bpm = 60 * fps / period
  return {
    bpm: Math.round(bpm * 100) / 100,
    confidence: mean > 0 ? Math.min(1, Math.max(0, (b / mean - 1) / 2)) : 0,
    beat: phase / fps,
  }
}

// ---------------------------------------------------------------- key

const KEY_FFT = 4096
// Krumhansl–Kessler key profiles, C first.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
// Camelot wheel numbers: major roots C..B, then minor roots.
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1]
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10]

/** In-place radix-2 FFT of (re, im). */
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
}

/** The song's pitch-class energy (12 values, C first), from FFT frames across it. */
function chroma(pcm, rate = RATE, frames = 120) {
  const out = new Float64Array(12)
  if (pcm.length < KEY_FFT) return out
  const step = Math.max(KEY_FFT, Math.floor((pcm.length - KEY_FFT) / frames))
  const window = Float32Array.from({ length: KEY_FFT }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (KEY_FFT - 1)))
  const pitch = new Int8Array(KEY_FFT / 2)
  for (let bin = 1; bin < KEY_FFT / 2; bin++) {
    const freq = bin * rate / KEY_FFT
    pitch[bin] = freq >= 55 && freq <= 2000 ? ((Math.round(12 * Math.log2(freq / 440)) % 12) + 12 + 9) % 12 : -1
  }
  const re = new Float64Array(KEY_FFT)
  const im = new Float64Array(KEY_FFT)
  for (let start = 0; start + KEY_FFT <= pcm.length; start += step) {
    for (let i = 0; i < KEY_FFT; i++) { re[i] = pcm[start + i] * window[i]; im[i] = 0 }
    fft(re, im)
    for (let bin = 1; bin < KEY_FFT / 2; bin++) {
      if (pitch[bin] < 0) continue
      out[pitch[bin]] += Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin])
    }
  }
  return out
}

function correlate(a, b) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  let num = 0
  let da = 0
  let dbb = 0
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; dbb += (b[i] - mb) ** 2 }
  return da && dbb ? num / Math.sqrt(da * dbb) : 0
}

/** Key from a chromagram: { root 0–11 (C = 0), mode 1 major / 0 minor, camelot "8B", confidence }. */
function key(chromagram) {
  if (!chromagram.some(value => value > 0)) return { root: null, mode: null, camelot: null, confidence: 0 }
  let best = { score: -2 }
  for (let root = 0; root < 12; root++) {
    const rotated = Array.from({ length: 12 }, (_, i) => chromagram[(i + root) % 12])
    const major = correlate(rotated, MAJOR)
    const minor = correlate(rotated, MINOR)
    if (major > best.score) best = { score: major, root, mode: 1 }
    if (minor > best.score) best = { score: minor, root, mode: 0 }
  }
  return {
    root: best.root,
    mode: best.mode,
    camelot: `${best.mode ? CAMELOT_MAJOR[best.root] : CAMELOT_MINOR[best.root]}${best.mode ? 'B' : 'A'}`,
    confidence: Math.max(0, Math.round(best.score * 100) / 100),
  }
}

// ---------------------------------------------------------------- all of it

/** Everything AutoMix uses, from a song's mono PCM at `rate`. */
function analyze(pcm, rate = RATE) {
  const env = envelope(pcm, rate)
  const bounds = edges(env)
  const kicks = onsets(pcm, 3)
  const beat = tempo(kicks, rate, kicks)
  const tonal = key(chroma(pcm, rate))
  const round = value => (value == null ? null : Math.round(value * 1000) / 1000)
  return {
    version: VERSION,
    duration: round(pcm.length / rate),
    leadIn: round(bounds.leadIn),
    audibleEnd: round(bounds.audibleEnd),
    fadeOutStart: round(bounds.fadeOutStart),
    loudness: round(bounds.loudness),
    energy: round(bounds.energy),
    intro: round(bounds.intro),
    outro: round(bounds.outro),
    bpm: beat.bpm,
    beatConfidence: round(beat.confidence),
    firstBeat: round(beat.beat),
    key: tonal.root,
    mode: tonal.mode,
    camelot: tonal.camelot,
    keyConfidence: tonal.confidence,
  }
}

module.exports = { analyze, envelope, edges, onsets, tempo, chroma, key, fft, RATE, VERSION }
