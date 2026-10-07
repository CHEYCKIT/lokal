export function nextPlaylistSort(current, column) {
  return { column, direction: current?.column === column && current.direction === 'asc' ? 'desc' : 'asc' }
}

// Library timestamps are seconds; playlist membership timestamps are ms.
function addedTime(value) {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null
  return timestamp < 1e12 ? timestamp * 1000 : timestamp
}

/** Sort the view, retaining playlist order for ties and unknown metadata last. */
export function sortPlaylistTracks(tracks, sort) {
  const descending = sort?.direction === 'desc'
  if (sort?.column === 'number') return descending ? [...tracks].reverse() : tracks
  if (!['added', 'time'].includes(sort?.column)) return tracks
  const valueOf = sort.column === 'added' ? track => addedTime(track.added_at) : track => {
    const duration = Number(track.duration)
    return Number.isFinite(duration) && duration > 0 ? duration : null
  }
  return tracks.map((track, index) => ({ track, index, value: valueOf(track) }))
    .sort((a, b) => {
      if (a.value === null) return b.value === null ? a.index - b.index : 1
      if (b.value === null) return -1
      return (a.value - b.value) * (descending ? -1 : 1) || a.index - b.index
    })
    .map(item => item.track)
}
