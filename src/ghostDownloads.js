// Downloading a playlist's ghost songs (the ones not in the library) from the
// playback sources, in the order chosen in Settings: a song imported from a
// CSV or a pasted list has only its title and artist, so it's looked up there
// first, the way radio and Mix songs are. Each file then takes its ghost's
// place in the playlist (the downloader's replaceImported).

import { api } from './api.js'
import { downloadBatchCurrent } from './downloadCancellation.js'
import { isGhostTrack, saveToLibrary, streamRef, isAddonProvider } from './onlineTracks.js'
import { mapLimited, playbackSources, resolveRecommendationTracks } from './recommendations.js'

/**
 * Download `ghosts` (a playlist's ghost tracks). Songs found in the library
 * take the ghost's place at once; the others are queued for download.
 * Returns { started, existing, failed, notFound }.
 */
export async function downloadGhostSongs(ghosts, { client = api, save = saveToLibrary, onProgress, isCurrent = () => true, concurrency = 3, confirmDuration } = {}) {
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
        tally(await save(ghost, {
          isCurrent,
          tags: {
            title: ghost.title || undefined,
            artist: ghost.artist || undefined,
            album: ghost.album || undefined,
          },
          expectedDuration: ghost.duration,
        }).catch(error => ({ error: error.message })))
        return
      }
      const candidate = { title: ghost.title, artist: ghost.artist, album: ghost.album || undefined, duration: ghost.duration }
      const resolve = candidate => resolveRecommendationTracks([candidate], client, {
        sources,
        isCurrent,
        preserveMatchMetadata: true,
      })
      let [found] = await resolve(candidate)
      let confirmed = false
      // Exhaust close matches in source order before offering another length.
      if (!found && confirmDuration && Number(ghost.duration) > 0 && isCurrent()) {
        const alternatives = await resolve({ ...candidate, duration: undefined })
        found = alternatives[0]
        if (found && differentDuration(ghost, found)) {
          confirmed = await confirmDuration(ghost, found) === true
          if (!isCurrent()) return
          if (!confirmed) { result.declined = (result.declined || 0) + 1; return }
        }
      }
      if (!isCurrent()) return
      if (!found) { result.notFound++; return }
      if (!isGhostTrack(found)) {
        // Already a file in the library: it takes the ghost's place now.
        const swapped = await client.resolveGhostTrack(ghost.id, found.id, {
          requireMetadataMatch: true,
          dedupePlaylist: true,
          ...(confirmed ? { allowDurationMismatch: true } : {}),
        }).catch(() => null)
        if (swapped?.ok) result.existing++
        else result.failed++
        return
      }
      tally(await save(found, {
        replaceImported: [ghost.id],
        ...(confirmed ? { confirmedImported: [ghost.id] } : {}),
        isCurrent,
        tags: {
          title: ghost.title || undefined,
          artist: ghost.artist || undefined,
          album: ghost.album || undefined,
        },
        expectedDuration: confirmed ? found.duration : ghost.duration,
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
export function ghostDownloadMessage({ started, existing, failed, notFound, cancelled, declined }) {
  return [
    cancelled && 'Stopped queuing songs',
    started && `Started ${started} download${started === 1 ? '' : 's'}`,
    existing && `${existing} already in your library`,
    notFound && `${notFound} not found on your playback sources`,
    failed && `${failed} unavailable`,
    declined && `${declined} skipped`,
  ].filter(Boolean).join('; ') || 'No songs to download.'
}

export function differentDuration(ghost, found) {
  const wanted = Number(ghost?.duration), actual = Number(found?.duration)
  return Number.isFinite(wanted) && wanted > 0 && Number.isFinite(actual) && actual > 0 && Math.abs(wanted - actual) > 10
}

/** A manually chosen source suggestion still belongs to its imported row. */
export async function downloadGhostResult(ghost, item, { client = api, save = saveToLibrary, confirmDuration, isCurrent = () => true } = {}) {
  isCurrent = downloadBatchCurrent(isCurrent)
  if (!ghost?.id || !item) return { error: 'Choose a song to replace first' }
  if (!isCurrent()) return { cancelled: true }
  const different = differentDuration(ghost, item)
  const confirmed = different && await confirmDuration?.(ghost, item) === true
  if (different && !confirmed) return { cancelled: true }
  if (!isCurrent()) return { cancelled: true }
  const replacement = {
    ...(ghost.missing ? {
      upgradeTrackId: ghost.id,
      allowUpgradeDurationMismatch: confirmed,
    } : {
      replaceImported: [ghost.id],
      manuallySelectedImported: [ghost.id],
      ...(different ? { confirmedImported: [ghost.id] } : {}),
    }),
    tags: { title: ghost.title, artist: ghost.artist, album: ghost.album || undefined },
    expectedDuration: Number(item.duration) > 0 ? Number(item.duration) : ghost.duration,
  }
  if (item.provider === 'sc' || isAddonProvider(item.provider)) {
    if (item.preview) return { error: 'This source only offers a preview' }
    const saved = await client.onlineSave([item])
    if (!isCurrent()) return { cancelled: true }
    const track = Array.isArray(saved) ? saved[0] : null
    if (!track?.id) return { error: saved?.error || 'Could not prepare the selected song' }
    return save(track, { ...replacement, isCurrent })
  }
  if (!item.url) return { error: 'This result has no download link' }
  return client.downloadYT(item.url, {
    title: item.title,
    thumbnail: item.thumbnail || undefined,
    from: 'Ghost track',
    ...replacement,
  })
}

/** Queue a replacement for a missing local file while retaining its track id. */
export async function redownloadMissingTrack(track, { client = api } = {}) {
  const ref = String(track?.source_ref || '').match(/^([^:]+):(.+)$/)
  if (!track?.missing || !ref) return { error: 'This song has no remembered download source.' }
  const provider = ref[1]
  let url = null
  let addonSource
  if (provider === 'yt') url = `https://music.youtube.com/watch?v=${ref[2]}`
  else if (provider === 'sc') url = `https://api.soundcloud.com/tracks/${ref[2]}`
  else if (/^a-[0-9a-f]{10}$/.test(provider)) {
    addonSource = { provider, id: ref[2] }
    const resolved = await client.onlineDownloadUrl(provider, ref[2]).catch(() => null)
    url = resolved?.url || null
  }
  if (!url) return { error: 'The original download source is unavailable.' }
  return client.downloadYT(url, {
    title: [track.artist, track.title].filter(Boolean).join(' - '),
    thumbnail: track.artwork_url || undefined,
    from: 'Redownload missing file',
    upgradeTrackId: track.id,
    addonSource,
    tags: { title: track.title, artist: track.artist, album: track.album || undefined },
    expectedDuration: track.duration,
  })
}

/** Search the explicitly selected source; retain its identity for downloading. */
export async function ghostDownloadSuggestions(query, provider, client = api) {
  if (!provider || !String(query || '').trim()) return []
  const response = provider === 'yt' ? await client.searchYT(query, 1) : await client.onlineSearch(query, provider)
  if (response?.error) throw new Error(response.error)
  const rows = Array.isArray(response) ? response : response?.results || []
  return rows.filter(item => !item.preview).slice(0, 8).map(item => ({ ...item, provider }))
}
