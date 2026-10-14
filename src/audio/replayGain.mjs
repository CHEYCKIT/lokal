export function normalizeReplayGainMode(value) {
  return ['off', 'track', 'album'].includes(value) ? value : 'off'
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function replayGainMultiplier(tags, mode) {
  mode = normalizeReplayGainMode(mode)
  if (mode === 'off' || !tags) return 1

  const albumGain = finiteNumber(tags.albumGainDb)
  const useAlbum = mode === 'album' && albumGain !== null
  const gainDb = useAlbum ? albumGain : finiteNumber(tags.trackGainDb)
  if (gainDb === null) return 1

  let multiplier = Math.pow(10, gainDb / 20)
  const peak = finiteNumber(useAlbum ? tags.albumPeak : tags.trackPeak)
  if (peak !== null && peak > 0) multiplier = Math.min(multiplier, 0.999 / peak)
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
}
