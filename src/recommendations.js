import { api } from './api.js'
import { DEFAULT_PLAYBACK_SOURCES, orderedPlaybackSources } from './playbackSources.js'
import { isPlayable, providerLabel } from './onlineTracks.js'

export const recommendationKey = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
export const songKey = track => `${recommendationKey(track?.artist)}\0${recommendationKey(track?.title)}`
export const sourceName = source => source === 'youtube' ? 'YouTube Music' : 'Last.fm'

export async function mapLimited(items, callback, concurrency = 4) {
  const out = new Array(items.length)
  let index = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) { const at = index++; out[at] = await callback(items[at], at) }
  }))
  return out
}

export function uniqueSongs(items) {
  const seen = new Set()
  return (Array.isArray(items) ? items : []).filter(track => {
    if (!track?.title || !track?.artist) return false
    const key = songKey(track)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const stripFeatured = suffix => /\b(?:remix|live|cover)\b/i.test(recommendationKey(suffix)) ? suffix : ''
const titleKey = title => recommendationKey(String(title || '')
  .replace(/\s*[([](?:official (?:audio|video)|lyrics?|audio)[)\]]/gi, '')
  .replace(/\s*[([](?:feat\.?|ft\.?|featuring)\s+[^)\]]+[)\]]/gi, stripFeatured)
  .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i, stripFeatured))

export function recommendationMatch(candidate, results) {
  const title = titleKey(candidate?.title)
  const artist = recommendationKey(candidate?.artist)
  if (!title || !artist) return null
  // Require both title and artist. A catalogue search is playback resolution,
  // not a second recommendation engine. Covers/remixes must not replace songs.
  return (Array.isArray(results) ? results : []).find(result => {
    const name = String(result?.title || '')
    const prefix = name.match(/^(.+?)\s+[-–—|]\s+(.+)$/)
    const resultTitle = prefix && recommendationKey(prefix[1]) === artist ? prefix[2] : name
    if (titleKey(resultTitle) !== title) return false
    const artists = Array.isArray(result.artists) ? result.artists : [result.artist]
    return artists.some(name => recommendationKey(name).replace(/ topic$/, '') === artist)
      || recommendationKey(result.artist).replace(/ topic$/, '') === artist
  }) || null
}

export async function timed(work, ms = 15000) {
  let timer
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Provider lookup timed out')), ms) })])
  } finally { clearTimeout(timer) }
}

export async function playbackSources(client = api, timeoutMs = 15000) {
  const [settings, available] = await Promise.all([
    timed(() => client.getSettings(), timeoutMs).catch(() => ({})),
    timed(() => client.onlineProviders(), timeoutMs).catch(() => DEFAULT_PLAYBACK_SOURCES),
  ])
  return orderedPlaybackSources(settings?.playback_search_order, Array.isArray(available) && available.length ? available : DEFAULT_PLAYBACK_SOURCES)
}

export const playableRecommendation = track => !!(track?.id && track.file_path && !track.preview && isPlayable(track))

export function playbackFallbackMessage({ candidate, source, nextSource, reason, detail }) {
  const label = source.label || providerLabel(source.id)
  const title = candidate.title || 'this song'
  const message = reason === 'preview' ? `${label} only has a preview of “${title}”.`
    : reason === 'not-found' ? `“${title}” wasn't found on ${label}.`
      : `“${title}” couldn't play on ${label}.`
  return `${message} ${detail ? `${detail} ` : ''}${nextSource ? `Trying ${nextSource.label || providerLabel(nextSource.id)}.` : 'No more playback sources are available.'}`
}

// Search metadata alone cannot tell whether a full stream is available (in
// particular, SoundCloud may only report its Go+ preview during resolution).
export async function playbackAvailability(match, provider, client = api, timeoutMs = 15000, onError = () => {}) {
  if (match.preview) return 'preview'
  if (typeof client.onlinePrepare !== 'function') return null
  const prepared = await timed(() => client.onlinePrepare(provider, String(match.id)), timeoutMs)
  if (prepared?.preview) return 'preview'
  if (prepared?.error) onError(prepared.error)
  return prepared?.ok && !prepared.error ? null : 'unavailable'
}

export async function resolveRecommendationTracks(candidates, client = api, { searchLocal = true, reusePlayable = true, isCurrent = () => true, timeoutMs = 15000, afterProvider, skipProviders = [], onProviderFailure, onProgress, prepareStreams = true, sources: configuredSources } = {}) {
  if (!Array.isArray(candidates) || !candidates.length || !isCurrent()) return []
  const ordered = configuredSources || await playbackSources(client, timeoutMs)
  const start = afterProvider ? ordered.findIndex(source => source.id === afterProvider) + 1 : 0
  const sources = ordered.slice(start).filter(source => source.id !== afterProvider && !skipProviders.includes(source.id))
  return (await mapLimited(uniqueSongs(candidates), async candidate => {
    if (!isCurrent()) return null
    if (reusePlayable && playableRecommendation(candidate)) return candidate
    try {
      const local = searchLocal ? await timed(() => client.searchTracks(candidate.title), timeoutMs).catch(() => null) : null
      const rows = Array.isArray(local) ? local : Array.isArray(local?.tracks) ? local.tracks : []
      // Imported ghosts and previously cached streams must not override a newly
      // configured provider order. Only a real library file takes precedence.
      let row = rows.find(track => playableRecommendation(track) && !track.file_path.startsWith('ghost://') && songKey(track) === songKey(candidate))
      if (!row) {
        for (const [index, source] of sources.entries()) {
          if (!isCurrent()) return null
          const failed = (reason, detail) => { if (isCurrent()) onProviderFailure?.({ candidate, source, nextSource: sources[index + 1], reason, ...(detail ? { detail } : {}) }) }
          try {
            if (isCurrent()) onProgress?.(`Searching ${source.label || providerLabel(source.id)} for ${candidate.artist} — “${candidate.title}”…`)
            const direct = source.id === 'yt' && candidate.videoId
            const response = direct ? null : await timed(() => client.onlineSearch(`${candidate.artist} ${candidate.title}`, source.id), timeoutMs)
            if (!isCurrent()) return null
            if (response?.error) { failed('unavailable', response.error); continue }
            const match = direct ? { ...candidate, provider: 'yt', id: candidate.videoId } : recommendationMatch(candidate, response?.results)
            if (!isCurrent()) return null
            if (!match) { failed('not-found'); continue }
            let detail
            const unavailable = match.preview ? 'preview' : prepareStreams || source.id === 'sc' ? await playbackAvailability(match, source.id, client, timeoutMs, message => { detail = message }) : null
            if (!isCurrent()) return null
            if (unavailable) { failed(unavailable, detail); continue }
            const saved = await timed(() => client.onlineSave([{ ...match, provider: source.id }]), timeoutMs)
            // saveOnlineTracks preserves order, including nulls, for all
            // providers (addon row IDs are hashed by the backend).
            row = Array.isArray(saved) && playableRecommendation(saved[0]) ? saved[0] : null
            if (row) break
            failed('unavailable')
          } catch (error) { failed('unavailable', error?.message) }
        }
      }
      return row && isCurrent() ? {
        ...row, title: candidate.title, artist: candidate.artist,
        album: candidate.album || row.album,
        artwork_url: candidate.artwork_url || row.artwork_url,
        source: candidate.source || 'lastfm', reason: candidate.reason,
        scrobbledAt: candidate.scrobbledAt, scrobbleCount: candidate.scrobbleCount,
      } : null
    } catch { return null }
  })).filter(Boolean)
}

// Build until the requested count, trying additional provider pages and
// skipping failed playback matches. Previous songs are considered only after
// new recommendations; there is no shuffle of the previous eight-song shelf.
export async function buildRecommendationMix({ size, previous = [], loadPage, resolve = resolveRecommendationTracks, isCurrent = () => true }) {
  const target = [24, 32, 40].includes(Number(size)) ? Number(size) : 32
  const previousKeys = new Set(previous.map(songKey))
  const tried = new Set()
  const ids = new Set()
  const tracks = []
  const repeats = []
  async function consume(pool) {
    const candidates = uniqueSongs(pool).filter(track => !tried.has(songKey(track)))
    for (let at = 0; at < candidates.length && tracks.length < target && isCurrent(); at += 8) {
      const batch = candidates.slice(at, at + 8)
      batch.forEach(track => tried.add(songKey(track)))
      const resolved = await resolve(batch)
      if (!isCurrent()) throw new Error('Mix request superseded')
      for (const track of resolved) {
        if (!track?.id || ids.has(track.id) || tracks.length >= target) continue
        ids.add(track.id)
        tracks.push(track)
      }
    }
  }
  for (let page = 0; page < 3 && tracks.length < target && isCurrent(); page++) {
    const data = await loadPage(page)
    if (!isCurrent()) throw new Error('Mix request superseded')
    if (data?.error) throw new Error(data.error)
    const pool = uniqueSongs(data?.candidates)
    repeats.push(...pool.filter(track => previousKeys.has(songKey(track))))
    await consume(pool.filter(track => !previousKeys.has(songKey(track))).slice(0, 120))
  }
  if (tracks.length < target) await consume(repeats)
  if (!isCurrent()) throw new Error('Mix request superseded')
  if (tracks.length !== target) throw new Error(`Found ${tracks.length} playable matches for ${target} requested tracks. Try again when more recommendations are available.`)
  if (previous.length && tracks.every(track => previousKeys.has(songKey(track)))) throw new Error('The provider returned the same songs. Your existing mix has been kept; try again after more listening.')
  return tracks
}

export async function loadRecommendationPage(source, page = 0, client = api, { force = false } = {}) {
  if (source !== 'youtube') return client.lastfmDiscovery(page, force)
  const account = await client.youtubeAccount(true)
  if (account?.error) return account
  const tracks = uniqueSongs((account?.home || []).map(track => ({ ...track, source: 'youtube', artwork_url: track.thumbnail })))
  const allPlaylists = account?.homePlaylists || []
  const start = allPlaylists.length ? page * 2 % allPlaylists.length : 0
  const playlists = [...allPlaylists.slice(start), ...allPlaylists.slice(0, start)].slice(0, 2)
  const expanded = await Promise.all(playlists.map(item => client.youtubeAccountPlaylist(item.id).catch(() => null)))
  const candidates = uniqueSongs([...tracks, ...expanded.flatMap(data => data?.tracks || []).map(track => ({ ...track, source: 'youtube', artwork_url: track.thumbnail }))])
  const picks = tracks.length ? tracks : candidates
  return {
    source: 'youtube', fetchedAt: Date.now(), candidates,
    freshFinds: candidates.slice(0, 30), quickPicks: picks.slice(0, 12), history: uniqueSongs(account?.history || []).map(track => ({ ...track, source: 'youtube', artwork_url: track.thumbnail })),
    artists: [...new Map([...(account?.artists || []), ...picks.flatMap(track => (track.artists || [track.artist]).map(name => ({ name, source: 'youtube' })))].filter(artist => artist.name).map(artist => [recommendationKey(artist.name), artist])).values()].slice(0, 30),
    albums: [...new Map([...(account?.albums || []), ...picks.filter(track => track.album).map(track => ({ title: track.album, artist: track.artist, albumId: track.albumId, artwork_url: track.thumbnail }))].map(album => [`${album.artist}\0${album.title}`, album])).values()].slice(0, 30),
    warnings: account.homeError ? [account.homeError] : [],
  }
}
