// The Discord app Lokal's Rich Presence uses unless Settings names another one.
export const DEFAULT_DISCORD_CLIENT_ID = '1473597925581131919'

/** The Discord app id from settings: the default one, or the custom one. */
export function discordClientId(settings = {}) {
  return settings.discord_use_default_app_id === '0' ? String(settings.discord_client_id || '').trim() : DEFAULT_DISCORD_CLIENT_ID
}

/** Publish playback changes immediately, with periodic drift correction. */
export function createDiscordPublisher({ getState, send, now = Date.now }) {
  let previous = null
  return () => {
    const state = getState()
    const track = state.currentTrack
    const audio = (state.activeAudioElement === 'cf' ? state.cfAudioRef : state.audioRef)?.current
    const audioMatches = audio && !audio.dataset?.lokalTrackPending &&
      (!audio.dataset?.lokalTrackId || String(audio.dataset.lokalTrackId) === String(track?.id))
    const seconds = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
    const position = audioMatches ? seconds(audio.currentTime) : audio ? 0 : seconds(state.progress)
    const duration = audioMatches && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : seconds(audio ? track?.duration : state.duration || track?.duration)
    const isPlaying = !!track && !!state.isPlaying
    const signature = JSON.stringify([track?.id, track?.title, track?.artist, track?.album, track?.album_artist, track?.artwork_url, track?.source_ref, track?.source_url, track?.file_path, isPlaying, duration])
    const at = now()
    const elapsed = previous ? at - previous.at : Infinity
    const expected = previous ? previous.position + (previous.isPlaying ? elapsed / 1000 : 0) : 0
    const changed = signature !== previous?.signature
    const seeked = Math.abs(position - expected) > 2 && elapsed >= 1000
    if (!changed && !seeked && elapsed < 15000) return
    // Empty/paused states need no heartbeat; seeking still updates a paused track.
    if (!changed && !seeked && !isPlaying) return
    previous = { signature, position, isPlaying, at }
    const snapshot = track ? { ...track, position_ms: Math.round(position * 1000), duration_ms: Math.round(duration * 1000) } : null
    Promise.resolve().then(() => send(snapshot, isPlaying)).catch(() => {})
  }
}
