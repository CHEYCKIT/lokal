// Downloading a playlist's ghost songs (the ones not in the library) from the
// playback sources, in the order chosen in Settings: a song imported from a
// CSV or a pasted list has only its title and artist, so it's looked up there
// first, the way radio and Mix songs are. Each file then takes its ghost's
// place in the playlist (the downloader's replaceImported).

import { api } from './api.js'
import { downloadBatchCurrent } from './downloadCancellation.js'
import { isGhostTrack, saveToLibrary, streamRef } from './onlineTracks.js'
import { mapLimited, playbackSources, resolveRecommendationTracks } from './recommendations.js'

/**
 * Download `ghosts` (a playlist's ghost tracks). Songs found in the library
 * take the ghost's place at once; the others are queued for download.
 * Returns { started, existing, failed, notFound }.
 */
export async function downloadGhostSongs(ghosts, { client = api, save = saveToLibrary, onProgress, isCurrent = () => true, concurrency = 3 } = {}) {
  isCurrent = downloadBatchCurrent(isCurrent)
  const list = (Array.isArray(ghosts) ? ghosts : []).filter(isGhostTrack)
  const result = { started: 0, existing: 0, failed: 0, notFound: 0 }
  if (!list.length) return result
  const sources = await playbackSources(client)
  let done = 0
  const tally = (response) => {
    if (response?.cancelled) return
    if (response?.alreadyInLibrary) result.existing++
    else if (response?.error) result.failed++
    else result.started++
  }
  await mapLimited(list, async (ghost) => {
    if (!isCurrent()) return
    try {
      // A streamed song (YouTube, SoundCloud, an addon) already has its source.
      if (streamRef(ghost)) {
        tally(await save(ghost, { isCurrent }).catch(error => ({ error: error.message })))
        return
      }
      const [found] = await resolveRecommendationTracks([{ title: ghost.title, artist: ghost.artist, album: ghost.album || undefined }], client, {
        sources,
        isCurrent,
        preserveMatchMetadata: true,
      })
      if (!isCurrent()) return
      if (!found) { result.notFound++; return }
      if (!isGhostTrack(found)) {
        // Already a file in the library: it takes the ghost's place now.
        const swapped = await client.resolveGhostTrack(ghost.id, found.id, {
          requireMetadataMatch: true,
          dedupePlaylist: true,
        }).catch(() => null)
        if (swapped?.ok) result.existing++
        else result.failed++
        return
      }
      tally(await save(found, {
        replaceImported: [ghost.id],
        isCurrent,
        tags: {
          title: ghost.title || undefined,
          artist: ghost.artist || undefined,
          album: ghost.album || undefined,
        },
        expectedDuration: ghost.duration,
      }).catch(error => ({ error: error.message })))
    } catch {
      result.failed++
    } finally {
      done++
      onProgress?.(`Finding and queuing songs… ${done}/${list.length}`)
    }
  }, concurrency)
  if (!isCurrent()) result.cancelled = true
  if (result.existing && typeof window !== 'undefined') window.dispatchEvent(new Event('lokal:refresh'))
  return result
}

/** What downloadGhostSongs did, in a sentence. */
export function ghostDownloadMessage({ started, existing, failed, notFound, cancelled }) {
  return [
    cancelled && 'Stopped queuing songs',
    started && `Started ${started} download${started === 1 ? '' : 's'}`,
    existing && `${existing} already in your library`,
    notFound && `${notFound} not found on your playback sources`,
    failed && `${failed} unavailable`,
  ].filter(Boolean).join('; ') || 'No songs to download.'
}
