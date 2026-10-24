// Progress counts actual observable startup milestones, not whole-song
// buffering or byte download completion. Mornye preparation supplies a REAL
// percentage (worker transfer/conversion); interpolate it into the preparation
// phase so the entire startup indicator remains monotonic per source.
export const STARTUP_STAGES = Object.freeze({
  preparing: 10, searching: 20, resolving: 30, fetching: 70,
  headers: 80, receiving: 90, decoding: 95, ready: 100,
})

export function startupProgress(phase, addonPercent = null) {
  if (phase === 'preparing' && Number.isFinite(addonPercent) &&
      addonPercent > 0 && addonPercent <= 100) {
    return 10 + Math.round(55 * addonPercent / 100)
  }
  return STARTUP_STAGES[phase] ?? null
}

export function withPreparationProgress(load, status, message = '') {
  if (!load) return null
  const value = Number(status?.progress ?? status?.percent)
  const real = (status?.progress != null || status?.percent != null) &&
    Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
  const addonPercent = real === null ? load.addonPercent
    : Math.max(load.addonPercent ?? 0, real)
  return {
    ...load, phase: 'preparing', addonPercent,
    message: message || String(status?.message || '').slice(0, 160),
  }
}

// next()/autoNext() update the queue position without advancing the store's
// playbackGeneration. Pair it with the logical queue slot and original song
// identity: switching tracks resets attempts, changing providers for the same
// song preserves them. Avoid provider-specific track IDs, which change on fallback.
export function streamLoadKey(state) {
  const track = state?.currentTrack
  if (!track) return null
  const slot = state.shuffle ? state.shuffleIndex : state.queueIndex
  return JSON.stringify([
    state.playbackGeneration ?? 0, state.shuffle ? 'shuffle' : 'queue', slot,
    String(track.title || '').trim().toLowerCase(),
    String(track.artist || '').trim().toLowerCase(),
  ])
}

// A new playback generation is a new loading session. Provider fallbacks keep
// that generation, increment the attempt and restart that source's milestones.
export function loadingSession(current, { generation, sourceKey, phase = 'preparing', message = '', attempt, recovering = false } = {}) {
  const same = current && current.generation === generation
  const source = sourceKey ?? (same ? current.sourceKey : '')
  const changedSource = same && source && source !== current.sourceKey
  const nextAttempt = Number.isInteger(attempt) ? attempt
    : same ? current.attempt + (changedSource ? 1 : 0) : 1
  return {
    generation, sourceKey: source, attempt: nextAttempt,
    phase, message, recovering, addonPercent: null, request: 0,
  }
}

export function acceptStreamSignal(load, signal, currentSourceKey) {
  if (!load || load.recovering || !signal || !currentSourceKey ||
      currentSourceKey !== `${signal.provider}:${signal.id}` ||
      (load.sourceKey && load.sourceKey !== currentSourceKey)) return null
  const incoming = startupProgress(signal.phase)
  if (incoming == null || signal.phase === 'ready') return null
  const request = Number(signal.request)
  const hasRequest = Number.isSafeInteger(request) && request > 0
  const seen = load.request || 0
  if (hasRequest && request < seen) return null
  const latest = hasRequest ? Math.max(seen, request) : seen
  const old = startupProgress(load.phase, load.addonPercent) ?? 0
  // A higher-numbered Range request might restart resolution, but progress
  // must not decrease. Record its token anyway: late bytes from the
  // superseded request must NOT finish this new request's progress.
  if (incoming <= old) {
    return latest > seen ? { ...load, request: latest } : null
  }
  return { ...load, request: latest, phase: signal.phase, addonPercent: null, sourceKey: currentSourceKey }
}
