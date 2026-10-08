// Crossfade timing and fade curves, ported from pear-desktop's crossfade
// plugin (MIT): the next song starts `beforeEnd` seconds before the current
// one ends, fades in over `fadeIn` while the old one fades out over `fadeOut`.
// The logarithmic curve is VolumeFader's (Nick Schwarzenberg, MIT): linear in
// dB over a 60 dB range, so the fade sounds even instead of dropping at the end.

export const CROSSFADE_DEFAULTS = Object.freeze({ beforeEnd: 0, fadeIn: 1.5, fadeOut: 5, curve: 'logarithmic' })
export const CROSSFADE_CURVES = ['logarithmic', 'linear']
/** The player only crossfades when `beforeEnd` is set above this. */
export const CROSSFADE_MIN_S = 0.5
const MIN_FADE_S = 0.05
const DYNAMIC_RANGE = 3 // multiples of 10 dB: 60 dB of amplitude

const seconds = (value, fallback, max) => {
  const n = parseFloat(value)
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback
}

/** Crossfade options from the stored settings (`crossfade_*` keys). */
export function readCrossfadeSettings(settings = {}) {
  return {
    beforeEnd: seconds(settings?.crossfade_seconds, CROSSFADE_DEFAULTS.beforeEnd, 30),
    fadeIn: seconds(settings?.crossfade_fade_in, CROSSFADE_DEFAULTS.fadeIn, 30),
    fadeOut: seconds(settings?.crossfade_fade_out, CROSSFADE_DEFAULTS.fadeOut, 30),
    curve: CROSSFADE_CURVES.includes(settings?.crossfade_curve) ? settings.crossfade_curve : CROSSFADE_DEFAULTS.curve,
  }
}

const toInternal = level => (level <= 0 ? 0 : Math.max(1 + Math.log10(level) / DYNAMIC_RANGE, 0))
const toLevel = internal => (internal <= 0 ? 0 : 10 ** ((internal - 1) * DYNAMIC_RANGE))

/** Gain values from `from` to `to` (0…1) for AudioParam.setValueCurveAtTime. */
export function fadeCurve(from, to, curve = CROSSFADE_DEFAULTS.curve, steps = 256) {
  const values = new Float32Array(Math.max(2, steps))
  const log = curve !== 'linear'
  const start = log ? toInternal(from) : from
  const end = log ? toInternal(to) : to
  for (let i = 0; i < values.length; i++) {
    const level = start + (end - start) * (i / (values.length - 1))
    values[i] = log ? toLevel(level) : level
  }
  return values
}

/**
 * How long each side fades once the next song is ready. The old song can't
 * fade for longer than it has left, or it would cut off at the end of the file.
 */
export function crossfadeDurations({ fadeIn, fadeOut }, remaining) {
  const left = Number.isFinite(remaining) && remaining > 0 ? remaining : fadeOut
  return {
    fadeIn: Math.max(MIN_FADE_S, fadeIn),
    fadeOut: Math.max(MIN_FADE_S, Math.min(fadeOut, left)),
  }
}
