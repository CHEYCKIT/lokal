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
    phase, message, recovering, addonPercent: null,
  }
}

export function acceptStreamSignal(load, signal, currentSourceKey) {
  if (!load || load.recovering || !signal || !currentSourceKey ||
      currentSourceKey !== `${signal.provider}:${signal.id}` ||
      (load.sourceKey && load.sourceKey !== currentSourceKey)) return null
  const incoming = startupProgress(signal.phase)
  if (incoming == null || signal.phase === 'ready') return null
  const old = startupProgress(load.phase, load.addonPercent) ?? 0
  // Ranges/seek retries and cancelled requests often resolve out of order.
  // Never rewind the startup indicator for the *same* attempt.
  if (incoming <= old) return null
  return { ...load, phase: signal.phase, addonPercent: null, sourceKey: currentSourceKey }
}
