// CSV exports label milliseconds explicitly; the library stores seconds.
function csvDuration(value, header) {
  if (value === undefined || value === null || String(value).trim() === '') return null
  const duration = Number(value)
  if (!Number.isFinite(duration) || duration < 0) return null
  const unit = String(header).toLowerCase().replace(/[^a-z]/g, '')
  return unit === 'durationms' || unit === 'durationmilliseconds' ? duration / 1000 : duration
}

module.exports = { csvDuration }
