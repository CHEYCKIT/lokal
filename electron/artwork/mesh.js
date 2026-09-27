// The colours behind the now-playing views, Apple Music style (as BitChord
// does it): not a 3-4 colour palette but the cover itself, averaged down to a
// 6x6 grid, flipped so the cover's bottom edge sits at the top of the grid
// (the gradient continues from where the artwork ends), a touch more
// saturated, and never pure black. The renderer smooths and blurs it.

let sharpLib = null
function sharp() {
  if (sharpLib === null) {
    try { sharpLib = require('sharp') } catch { sharpLib = false }
  }
  return sharpLib || null
}

const GRID = 6
const cache = new Map() // path|mtime -> grid

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  return [h, s, l]
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
  const hue = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map(v => Math.round(v * 255))
}

/** Tune one cell: a little more colour, never quite black. */
function tune([r, g, b]) {
  const [h, s, l] = rgbToHsl(r, g, b)
  return hslToRgb(h, Math.min(1, s * 1.12), Math.max(0.045, l))
}

/**
 * @param source a file path or an image Buffer
 * @returns {Promise<number[][][]|null>} GRID rows x GRID columns of [r,g,b]; row 0 = the cover's bottom edge
 */
async function meshFromImage(source, cacheKey = null) {
  const s = sharp()
  if (!s || !source) return null
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey)
  try {
    const size = GRID * 16
    const { data, info } = await s(source).resize(size, size, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const cell = size / GRID
    const grid = []
    for (let gy = 0; gy < GRID; gy++) {
      const row = []
      // Flipped: row 0 comes from the bottom of the cover.
      const srcY = GRID - 1 - gy
      for (let gx = 0; gx < GRID; gx++) {
        let r = 0, g = 0, b = 0, n = 0
        for (let y = srcY * cell; y < (srcY + 1) * cell; y++) {
          for (let x = gx * cell; x < (gx + 1) * cell; x++) {
            const i = (y * info.width + x) * info.channels
            r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
          }
        }
        row.push(tune([r / n, g / n, b / n]))
      }
      grid.push(row)
    }
    if (cacheKey) {
      if (cache.size > 200) cache.delete(cache.keys().next().value)
      cache.set(cacheKey, grid)
    }
    return grid
  } catch {
    return null
  }
}

module.exports = { meshFromImage, GRID }
