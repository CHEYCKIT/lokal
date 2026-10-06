import { api } from './api.js'
import { playbackSources, recommendationKey, timed, uniqueSongs } from './recommendations.js'

// A release title without edition labels: "I Am (Expanded Edition)" -> "i am".
const releaseKey = title => recommendationKey(String(title || '').replace(/\s*[([][^)\]]*[)\]]/g, '')) || recommendationKey(title)

/** Metadata identifies album tracks; each song is then resolved in playback priority order. */
/** searchSources: false stops after the catalogues (YouTube Music, Last.fm), before searching the playback sources. */
export async function loadDiscoveryCatalogue(options, client = api, { isCurrent = () => true, onProgress = () => {}, timeoutMs = 12000, skipSources = [], searchSources = true } = {}) {
  const excluded = new Set(skipSources)
  // Native artist results include real song IDs, avoiding a second ambiguous search.
  const sources = options.type === 'artist' || options.source === 'youtube' ? ['youtube', 'lastfm'] : ['lastfm', 'youtube']
  for (const source of sources) {
    if (excluded.has(source)) continue
    if (!isCurrent()) return { tracks: [] }
    onProgress(`Loading ${options.type === 'album' ? options.album : options.artist} from ${source === 'youtube' ? 'YouTube Music' : 'Last.fm'}…`)
    const result = await timed(() => client.discoveryCatalogue({ ...options, source }), timeoutMs).catch(() => null)
    if (!isCurrent()) return { tracks: [] }
    const tracks = uniqueSongs(result?.tracks)
    if (tracks.length) return { tracks: options.type === 'artist' ? tracks.slice(0, 24) : tracks, catalogueSource: source }
  }
  if (!searchSources) return { tracks: [], error: options.type === 'album' ? `No catalogue has “${options.album}” by ${options.artist}.` : `No catalogue has songs by ${options.artist}.` }
  for (const source of await playbackSources(client, timeoutMs)) {
    if (excluded.has(source.id)) continue
    if (!isCurrent()) return { tracks: [] }
    onProgress(`Searching ${source.label || source.id} for ${options.type === 'album' ? options.album : options.artist}…`)
    const result = await timed(() => client.onlineSearch([options.artist, options.type === 'album' ? options.album : ''].filter(Boolean).join(' '), source.id), timeoutMs).catch(() => null)
    if (!isCurrent()) return { tracks: [] }
    const tracks = uniqueSongs((result?.results || []).filter(track => {
      const artists = [track.artist, ...(track.artists || [])]
      return artists.some(artist => recommendationKey(artist).replace(/ topic$/, '') === recommendationKey(options.artist))
        && (options.type !== 'album' || releaseKey(track.album) === releaseKey(options.album))
    }).map(track => ({ ...track, videoId: source.id === 'yt' ? track.videoId || track.id : undefined, provider: source.id })))
    if (tracks.length) {
      if (options.type === 'album') tracks.sort((a, b) => (Number(a.track_num || a.trackNumber) || 1000) - (Number(b.track_num || b.trackNumber) || 1000))
      return { tracks: options.type === 'artist' ? tracks.slice(0, 24) : tracks, catalogueSource: source.id }
    }
  }
  return { tracks: [], error: options.type === 'album' ? `No matching album was found for “${options.album}” by ${options.artist} in your sources.` : `No matching songs were found for ${options.artist} in your sources.` }
}
