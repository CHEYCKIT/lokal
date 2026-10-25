'use strict'

// Native search results carry a canonical provider ID. Some Morneye addons
// re-request that exact record during enrichTrack, then request it *again*
// during checkAvailability. That unnecessary round trip delays streaming.
// Never skip for cross-provider matches or incomplete download metadata.
function skipPlaybackEnrichment({ addon, track, remembered, purpose } = {}) {
  if (purpose !== 'playback' || !remembered || !track?.id || !track?.name) return false
  const provider = String(addon?.name || '').toLowerCase().replace(/-web$/, '')
  const owner = String(track?.provider_id || '').toLowerCase().replace(/-web$/, '')
  const id = String(track.id)
  // Even a manifest optimization must not bypass ownership checks for
  // remembered rows supplied by a different source.
  if (owner !== provider) return false
  if (addon?.manifest?.skipMetadataEnrichment === true) return true
  if (provider === 'tidal' || provider === 'deezer' || provider === 'qobuz')
    return /^[1-9][0-9]{0,19}$/.test(id)
  if (provider === 'amazon')
    return /^[a-z0-9]{10}$/i.test(id)
  return false
}

module.exports = { skipPlaybackEnrichment }
