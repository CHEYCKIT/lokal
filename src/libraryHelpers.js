/** Shuffle without mutating the input array. */
export function shuffledLibraryTracks(tracks) {
  const shuffled = Array.isArray(tracks) ? [...tracks] : []
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

/**
 * Fetch every page for a filtered library query without changing its filters.
 */
export async function fetchAllTrackPages(getTracks, filters = {}, pageSize = 5000) {
  if (typeof getTracks !== 'function') throw new TypeError('getTracks must be a function')
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('pageSize must be a positive integer')

  const tracks = []
  let offset = 0
  while (true) {
    const page = await getTracks({ ...filters, limit: pageSize, offset })
    if (!Array.isArray(page)) throw new TypeError('Track query did not return an array')
    tracks.push(...page)
    if (page.length < pageSize) return tracks
    offset += page.length
  }
}

/**
 * Load every track flagged with an error. The main-process IPC clamps each
 * response to 5,000 rows, so walk offsets until the final partial page.
 */
export async function fetchAllErrorTrackIds(getTracks, pageSize = 5000) {
  if (typeof getTracks !== 'function') throw new TypeError('getTracks must be a function')
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('pageSize must be a positive integer')
  const ids = new Set()
  let offset = 0
  while (true) {
    const response = await getTracks({ problems: true, limit: pageSize, offset, sort: 'added_at DESC' })
    const rows = Array.isArray(response) ? response : []
    const before = ids.size
    for (const track of rows) {
      if (track?.id !== undefined && track?.id !== null) ids.add(String(track.id))
    }
    offset += rows.length
    if (rows.length < pageSize || ids.size === before) break
  }
  return ids
}

/**
 * Build the tracks used by Play All after folder search/filtering. Folders
 * without direct tracks use their descendant list; direct and searched
 * descendant tracks are sorted together so playback follows the selected sort.
 */
export function getFolderPlaybackTracks({
  term = '',
  directTracks = [],
  hasDirectTracks = false,
  deepTracks = [],
  allTracks = [],
  matchesFilters = () => true,
  sortTracks = tracks => tracks,
} = {}) {
  if (!term && !hasDirectTracks && directTracks.length === 0 && allTracks.length > 0) {
    return sortTracks(allTracks.filter(matchesFilters))
  }
  return sortTracks([...directTracks, ...deepTracks])
}
