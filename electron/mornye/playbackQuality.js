'use strict'

// The catalogue can advertise both stereo and Dolby Atmos for one Tidal ID.
// Ordinary HTMLAudioElement streaming is never a native JOC transport. Keep
// its quality selection independent of a user's Atmos download preference.
function isAtmosQuality(value) {
  return /^(?:DOLBY[_ -]?ATMOS|ATMOS)$/i.test(String(value || '').trim())
}

function stereoPlaybackQuality(addon, settings = {}) {
  const configured = settings.downloadQuality
  if (!isAtmosQuality(configured)) return configured || undefined
  const options = addon?.manifest?.qualityOptions || []
  const stereo = options.filter(opt => opt?.id && !isAtmosQuality(opt.id) &&
    !isAtmosQuality(opt.kind) && !isAtmosQuality(opt.name) &&
    !isAtmosQuality(opt.label))
  const rank = opt => {
    const id = String(opt.id).toUpperCase()
    if (id === 'HI_RES_LOSSLESS') return 0
    if (id === 'LOSSLESS') return 1
    if (id === 'HIGH') return 2
    return opt.kind === 'lossless' ? 3 : 4
  }
  stereo.sort((a, b) => rank(a) - rank(b))
  // Tidal's stereo tiers have stable IDs. Never use the Atmos tier merely
  // because an add-on didn't publish the optional qualityOptions manifest.
  return stereo[0]?.id || (/tidal/i.test(addon?.name || '') ? 'HI_RES_LOSSLESS' : undefined)
}

module.exports = { isAtmosQuality, stereoPlaybackQuality }
