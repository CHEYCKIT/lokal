// Search history (what was searched) and recent items (what was opened from a
// search), kept in this browser/app. Same storage keys as before, so
// existing history carries over.

const RECENT_SEARCHES_KEY = 'lokal-recent-searches'
const RECENT_ITEMS_KEY = 'lokal-recent-items'
const MAX_SEARCHES = 20
// Recently opened artists, albums and tracks (the covers shown before typing): 3 rows of 5.
const MAX_ITEMS = 15
export const HISTORY_EVENT = 'lokal:search-history'

/** A stored JSON list, or [] if missing or unreadable. */
function read(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

/** Store a JSON list and tell listeners the history changed. */
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
  window.dispatchEvent(new Event(HISTORY_EVENT))
}

/** Past searches, newest first. */
export function getRecentSearches() {
  return read(RECENT_SEARCHES_KEY).filter(r => r && typeof r.query === 'string' && r.query.trim())
}

/** Put `query` at the top of the history (case-insensitive de-duplication). */
export function saveRecentSearch(query) {
  const q = String(query || '').trim()
  if (!q) return
  const rest = getRecentSearches().filter(r => r.query.toLowerCase() !== q.toLowerCase())
  write(RECENT_SEARCHES_KEY, [{ query: q, timestamp: Date.now() }, ...rest].slice(0, MAX_SEARCHES))
}

/** Remove one past search. */
export function removeRecentSearch(query) {
  write(RECENT_SEARCHES_KEY, getRecentSearches().filter(r => r.query !== query))
}

/** Forget all past searches. */
export function clearRecentSearches() {
  try { localStorage.removeItem(RECENT_SEARCHES_KEY) } catch {}
  window.dispatchEvent(new Event(HISTORY_EVENT))
}

/** Artists, albums and tracks recently opened from a search, newest first. */
export function getRecentItems() {
  return read(RECENT_ITEMS_KEY)
}

/**
 * A track as a recent item. Songs streamed from search (ghost tracks) keep
 * what's needed to play them again (their stream path) and their remote cover.
 */
export function recentTrackItem(track) {
  const item = {
    id: track.id,
    name: track.title,
    artist: track.artist,
    artwork_path: track.artwork_path || null,
    type: 'track',
  }
  if (String(track.file_path || '').startsWith('ghost://')) {
    Object.assign(item, {
      file_path: track.file_path,
      source_url: track.source_url || null,
      artwork_url: track.artwork_url || null,
      album: track.album || null,
      duration: track.duration || null,
    })
  }
  return item
}

/** Put an opened artist, album or track at the top of the recent items. */
export function saveRecentItem(item) {
  if (!item?.id) return
  const rest = getRecentItems().filter(r => r.id !== item.id)
  write(RECENT_ITEMS_KEY, [item, ...rest].slice(0, MAX_ITEMS))
}

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * Past searches closest to what's typed: starts with it first, then a word
 * starting with it, then containing it anywhere; newest first within each.
 * An empty query gives the whole history, newest first.
 */
export function matchRecentSearches(history, typed, limit = 8) {
  const q = fold(typed)
  if (!q) return history.slice(0, limit)
  const ranked = []
  history.forEach((entry, order) => {
    const text = fold(entry.query)
    if (text === q) return // already what's in the box
    let rank = -1
    if (text.startsWith(q)) rank = 0
    else if (text.split(/[\s\-_/.,()&]+/).some(word => word.startsWith(q))) rank = 1
    else if (text.includes(q)) rank = 2
    if (rank >= 0) ranked.push({ entry, rank, order })
  })
  return ranked.sort((a, b) => a.rank - b.rank || a.order - b.order).slice(0, limit).map(r => r.entry)
}
