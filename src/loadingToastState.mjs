/**
 * Independent request-owned loading layer. Ephemeral notifications cannot
 * replace a progress request or cause its animation to restart.
 */
export function applyLoadingToastEvent(pending, detail = {}) {
  if (detail.finish) {
    pending.delete(detail.finish)
    return { handled: true, confirmation: detail.message || '' }
  }
  if (detail.loading && detail.id) {
    if (detail.update && !pending.has(detail.id)) return { handled: true }
    pending.set(detail.id, {
      id: detail.id,
      message: detail.message,
      loading: true,
      progress: detail.progress ?? null,
    })
    return { handled: true }
  }
  return { handled: !!detail.update }
}

export function currentLoadingToast(pending) {
  return [...pending.values()].at(-1) || null
}
