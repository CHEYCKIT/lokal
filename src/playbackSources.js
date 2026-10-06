export const DEFAULT_PLAYBACK_SOURCES = [{ id: 'yt', label: 'YouTube Music' }, { id: 'sc', label: 'SoundCloud' }]

export function orderedPlaybackSources(saved, available = DEFAULT_PLAYBACK_SOURCES) {
  let order = saved
  if (typeof saved === 'string') { try { order = JSON.parse(saved) } catch { order = [] } }
  const providers = new Map(available.map(provider => [provider.id, provider]))
  return [...new Set([...(Array.isArray(order) ? order : []), ...available.map(provider => provider.id)])]
    .filter(id => providers.has(id)).map(id => providers.get(id))
}

/**
 * The saved order with the source at `index` (of the ones shown, as
 * orderedPlaybackSources gives them) moved by `direction` (-1 up, +1 down).
 * Sources not available right now (an addon turned off, being reinstalled,
 * or still loading) keep their place in it: before, moving anything saved
 * only the ones shown, and such an addon came back last.
 */
export function movePlaybackSource(saved, available, index, direction) {
  let order = saved
  if (typeof saved === 'string') { try { order = JSON.parse(saved) } catch { order = [] } }
  const shown = orderedPlaybackSources(order, available).map(source => source.id)
  const full = [...new Set([...(Array.isArray(order) ? order : []), ...shown])]
  const from = shown[index]
  const to = shown[index + direction]
  if (!from || !to) return full
  const a = full.indexOf(from)
  const b = full.indexOf(to)
  ;[full[a], full[b]] = [full[b], full[a]]
  return full
}
