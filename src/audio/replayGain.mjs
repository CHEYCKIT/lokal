export function normalizeReplayGainMode(value) {
  return ['off', 'track', 'album', 'smart'].includes(value) ? value : 'off'
}

function normalizeAlbumTag(value) {
  return String(value || '').trim().toLocaleLowerCase()
}

export function effectiveReplayGainMode(mode, track, state = {}) {
  mode = normalizeReplayGainMode(mode)
  if (mode !== 'smart') return mode

  const album = normalizeAlbumTag(track?.album)
  if (!album) return 'track'

  const contextAlbum = normalizeAlbumTag(state.playbackContext?.album?.title || state.playbackContext?.name)
  if (state.playbackContext?.type === 'album' && contextAlbum === album) return 'album'

  const queue = state.shuffle && state.originalQueue?.length
    ? state.originalQueue
    : state.queue
  if (!Array.isArray(queue) || queue.length < 2) return 'track'

  const albumArtist = normalizeAlbumTag(track.album_artist || track.artist)
  if (!albumArtist) return 'track'
  const albumQueue = queue.every(item =>
    normalizeAlbumTag(item?.album) === album &&
    normalizeAlbumTag(item?.album_artist || item?.artist) === albumArtist)
  return albumQueue ? 'album' : 'track'
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
  const albumPeak = useAlbum ? finiteNumber(tags.albumPeak) : null
  const peak = albumPeak ?? finiteNumber(tags.trackPeak)
  if (peak !== null && peak > 0) multiplier = Math.min(multiplier, 0.999 / peak)
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
}
