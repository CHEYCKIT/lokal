import { api } from './api.js'
import { playbackSources, recommendationKey, timed, uniqueSongs } from './recommendations.js'

/** Metadata identifies album tracks; each song is then resolved in playback priority order. */
export async function loadDiscoveryCatalogue(options, client = api, { isCurrent = () => true, onProgress = () => {}, timeoutMs = 12000 } = {}) {
  const sources = options.source === 'youtube' ? ['youtube', 'lastfm'] : ['lastfm', 'youtube']
  for (const source of sources) {
    if (!isCurrent()) return { tracks: [] }
    onProgress(`Loading ${options.type === 'album' ? options.album : options.artist} from ${source === 'youtube' ? 'YouTube Music' : 'Last.fm'}…`)
    const result = await timed(() => client.discoveryCatalogue({ ...options, source }), timeoutMs).catch(() => null)
    if (!isCurrent()) return { tracks: [] }
    const tracks = uniqueSongs(result?.tracks)
    if (tracks.length) return { tracks: options.type === 'artist' ? tracks.slice(0, 24) : tracks }
  }
  for (const source of await playbackSources(client, timeoutMs)) {
    if (!isCurrent()) return { tracks: [] }
    onProgress(`Searching ${source.label || source.id} for ${options.type === 'album' ? options.album : options.artist}…`)
    const result = await timed(() => client.onlineSearch([options.artist, options.type === 'album' ? options.album : ''].filter(Boolean).join(' '), source.id), timeoutMs).catch(() => null)
    if (!isCurrent()) return { tracks: [] }
    const tracks = uniqueSongs((result?.results || []).filter(track => {
      const artists = [track.artist, ...(track.artists || [])]
      return artists.some(artist => recommendationKey(artist).replace(/ topic$/, '') === recommendationKey(options.artist))
        && (options.type !== 'album' || recommendationKey(track.album) === recommendationKey(options.album))
    }).map(track => ({ ...track, videoId: source.id === 'yt' ? track.videoId || track.id : undefined, provider: source.id })))
    if (tracks.length) {
      if (options.type === 'album') tracks.sort((a, b) => (Number(a.track_num || a.trackNumber) || 1000) - (Number(b.track_num || b.trackNumber) || 1000))
      return { tracks: options.type === 'artist' ? tracks.slice(0, 24) : tracks }
    }
  }
  return { tracks: [], error: options.type === 'album' ? `No matching album was found for “${options.album}” by ${options.artist} in your sources.` : `No matching songs were found for ${options.artist} in your sources.` }
}
