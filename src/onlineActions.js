// Playing and downloading the songs of the online album and artist pages
// (see onlineBrowse.js), with progress in a toast.

import { api } from './api.js'
import { libraryDownloadMessage, saveTracksToLibrary } from './onlineTracks.js'
import { playRecommendationPool } from './recommendationPlayback.js'
import { playbackFallbackMessage, resolveRecommendationTracks } from './recommendations.js'
import { showLoadingToast, showToast } from './components/Toaster.jsx'

/** Play `tracks` from `selected` (or the first), finding each in the playback sources. */
export async function playOnline(tracks, { selected, name, path, isCurrent = () => true } = {}) {
  const first = selected || tracks[0]
  if (!first) return false
  const toast = showLoadingToast(`Finding “${first.title}”…`)
  let detail = ''
  try {
    const started = await playRecommendationPool(tracks, {
      selected, firstPlayable: true, isCurrent,
      context: { type: 'discovery', name, path },
      onProgress: message => { if (isCurrent()) toast.update(message) },
      onProviderFailure: failure => { if (isCurrent()) { if (failure.detail) detail = failure.detail; toast.update(playbackFallbackMessage(failure)) } },
    })
    toast.close(isCurrent() && started === false ? detail ? `Could not play “${first.title}”. ${detail}` : `No playable source was found for “${first.title}”.` : '')
    return started
  } catch {
    toast.close(isCurrent() ? `Could not load “${first.title}”.` : '')
    return false
  }
}

/** Find `tracks` in the playback sources (without preparing streams). */
export async function resolveOnline(tracks, { label, isCurrent = () => true } = {}) {
  const toast = showLoadingToast(`Finding ${label || (tracks.length === 1 ? `“${tracks[0].title}”` : `${tracks.length} songs`)}…`)
  try {
    const rows = await resolveRecommendationTracks(tracks, api, { isCurrent, prepareStreams: false, onProgress: message => { if (isCurrent()) toast.update(message) } })
    toast.close(!rows.length && isCurrent() ? `No playable source was found for ${label || 'these songs'}.` : '')
    return isCurrent() ? rows : []
  } catch {
    toast.close(isCurrent() ? `Could not load ${label || 'these songs'}.` : '')
    return []
  }
}

/** Download `tracks` to the library, from the best playback source for each. */
export async function downloadOnline(tracks, { label, isCurrent = () => true } = {}) {
  const rows = await resolveOnline(tracks, { label, isCurrent })
  if (!rows.length) return
  const result = await saveTracksToLibrary(rows, { isCurrent })
  result.failed += tracks.length - rows.length
  showToast(libraryDownloadMessage(result))
}
