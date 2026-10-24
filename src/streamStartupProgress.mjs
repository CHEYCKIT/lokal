// Progress here measures completion of observable *startup milestones*, not
// whole-song download completion. Some add-ons are chunked/live and omit
// Content-Length and media buffered ranges. Never show an invented byte %.
export const STARTUP_STAGES = Object.freeze({
  preparing: 10, searching: 20, resolving: 30, fetching: 45,
  headers: 65, receiving: 80, decoding: 90, ready: 100,
})

export function startupProgress(phase) {
  return STARTUP_STAGES[phase] ?? null
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
    phase, message, recovering,
  }
}

export function acceptStreamSignal(load, signal, currentSourceKey) {
  if (!load || load.recovering || !signal || !currentSourceKey ||
      currentSourceKey !== `${signal.provider}:${signal.id}` ||
      (load.sourceKey && load.sourceKey !== currentSourceKey)) return null
  const incoming = startupProgress(signal.phase)
  if (incoming == null || signal.phase === 'ready') return null
  const old = startupProgress(load.phase) ?? 0
  // Ranges/seek retries and cancelled requests often resolve out of order.
  // Never rewind the startup indicator for the *same* attempt.
  if (incoming <= old) return null
  return { ...load, phase: signal.phase, sourceKey: currentSourceKey }
}
