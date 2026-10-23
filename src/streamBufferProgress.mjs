// Chromium media streaming often knows the track length from the catalogue
// before it exposes a usable HTMLMediaElement.duration. The percentage
// represents *buffered media time*, not downloaded bytes or network progress.
export function bufferedMediaPercent(buffered, duration, fallbackDuration = null) {
  const valid = value => Number.isFinite(Number(value)) && Number(value) > 0
  const seconds = valid(duration) ? Number(duration) :
    valid(fallbackDuration) ? Number(fallbackDuration) : null
  if (!seconds || !buffered || !Number.isInteger(buffered.length) || buffered.length < 0) return null
  try {
    const intervals = []
    for (let i = 0; i < buffered.length; i++) {
      const start = Math.max(0, Number(buffered.start(i)))
      const end = Math.min(seconds, Number(buffered.end(i)))
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
      intervals.push([start, end])
    }
    intervals.sort((a, b) => a[0] - b[0])
    let total = 0
    let previousEnd = 0
    for (const [start, end] of intervals) {
      if (end > previousEnd) total += end - Math.max(start, previousEnd)
      previousEnd = Math.max(previousEnd, end)
    }
    return Math.max(0, Math.min(100, Math.floor(total / seconds * 100)))
  } catch { return null }
}
