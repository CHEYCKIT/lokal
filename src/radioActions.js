import { api } from './api.js'
import { streamRef } from './onlineTracks.js'
import { mapLimited, playbackAvailability, playbackSources, playableRecommendation, recommendationKey, recommendationMatch, resolveRecommendationTracks, songKey, timed } from './recommendations.js'

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(feat|ft|featuring)\b.*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniqueTracks(tracks) {
  return (Array.isArray(tracks) ? tracks : [])
    .filter(playableRecommendation)
    .filter((track, index, list) => list.findIndex(item => item.id === track.id || songKey(item) === songKey(track)) === index)
    .slice(0, 50)
}

function artistMatches(artist, result) {
  const wanted = recommendationKey(artist)
  return wanted && [result?.artist, ...(result?.artists || [])]
    .some(name => recommendationKey(name).replace(/ topic$/, '') === wanted)
}

const RADIO_MAX = 50

async function searchAndSaveArtistSongs(artists, client, { sources: given, isCurrent = () => true, enough = () => false, onFound } = {}) {
  const sources = given || await playbackSources(client)
  const searches = await mapLimited(artists, async artist => {
    for (const source of sources) {
      if (!isCurrent() || enough()) return []
      try {
        const result = await timed(() => client.onlineSearch(artist, source.id))
        const matches = (Array.isArray(result?.results) ? result.results : [])
          .filter(item => item.title && artistMatches(artist, item))
          .filter(item => item.kind !== 'video' || item.official).slice(0, 2)
        if (!matches.length) continue
        const available = (await mapLimited(matches, async item => await playbackAvailability(item, source.id, client).catch(() => 'unavailable') ? null : item)).filter(Boolean)
        if (!available.length) continue
        const saved = await timed(() => client.onlineSave(available.map(item => ({ ...item, provider: source.id }))))
        const tracks = (Array.isArray(saved) ? saved : []).filter(playableRecommendation)
        if (tracks.length) { onFound?.(tracks); return tracks }
      } catch { /* Try the next configured playback provider. */ }
    }
    return []
  })
  return searches.flat()
}

async function youtubeRadioSeed(seed, mode, client) {
  if (mode !== 'track') return null
  const stream = streamRef(seed)
  const source = String(seed.source_ref || '').match(/^yt:([\w-]{11})$/)?.[1]
  const linked = streamRef({ ...seed, file_path: 'ghost://imported' })
  const id = (stream?.provider === 'yt' ? stream.id : null)
    || source || (linked?.provider === 'yt' ? linked.id : null) || seed.videoId
  if (/^[\w-]{11}$/.test(String(id || ''))) return id
  if (!seed.title || !seed.artist) return null
  try {
    const result = await timed(() => client.onlineSearch(`${seed.artist} ${seed.title}`, 'yt'))
    const match = recommendationMatch(seed, result?.results)
    const matchedId = match?.videoId || match?.id
    return /^[\w-]{11}$/.test(String(matchedId || '')) ? matchedId : null
  } catch { return null }
}

/**
 * The radio's songs (at most 50). They're found one by one, each looked up on
 * the playback sources, which can take a while: onTracks gets the list so far
 * every time it grows (the seed first, when it's playable), so a radio can
 * start playing with its first songs and fill in after. isCurrent() false
 * stops the work (the radio was left or rebuilt).
 */
export async function buildRadio(seed, userId, client = api, { onTracks, isCurrent = () => true } = {}) {
  if (!seed?.artist && !seed?.title) return []
  const mode = seed.type || (!seed.title || normalize(seed.title) === normalize(seed.artist) ? 'artist' : 'track')
  const found = seed.id ? [seed] : []
  const list = () => uniqueTracks(found)
  const enough = () => list().length >= RADIO_MAX
  const add = tracks => {
    if (!isCurrent() || !tracks?.length) return
    found.push(...tracks)
    onTracks?.(list())
  }
  if (found.length && list().length) onTracks?.(list())
  // Recommendation identity is independent of where the resulting songs play.
  // YouTube Music's radio and Last.fm are asked at the same time.
  const [radio, similar] = await Promise.all([
    youtubeRadioSeed(seed, mode, client).then(videoId => videoId ? timed(() => client.youtubeRadio(videoId)).catch(() => []) : []),
    timed(() => client.lastfmSimilar(seed.artist, mode === 'track' ? seed.title : null, 32)).catch(() => null),
  ])
  if (!isCurrent()) return []
  const similarTracks = mode === 'track' && Array.isArray(similar?.tracks) ? similar.tracks : []
  const similarArtists = mode !== 'track' && Array.isArray(similar?.artists)
    ? similar.artists.map(artist => artist.name).filter(Boolean)
    : []
  const candidates = [...(Array.isArray(radio) ? radio : []), ...similarTracks]
  if (candidates.length || similarArtists.length) {
    const sources = await playbackSources(client)
    // Each song is announced as soon as it's found (four looked up at a time),
    // instead of after the whole list.
    await mapLimited(candidates, async candidate => {
      if (!isCurrent() || enough()) return
      add(await resolveRecommendationTracks([candidate], client, { sources, isCurrent }))
    })
    if (similarArtists.length && isCurrent() && !enough()) {
      await searchAndSaveArtistSongs(similarArtists, client, { sources, isCurrent, enough, onFound: add })
    }
  }

  // All recommendations here come from YouTube Music radio or Last.fm
  // similar results. The local library is only the optional seed.
  return isCurrent() ? list() : []
}

/** Why a radio came out empty, in words for the person who asked for it. */
export function emptyRadioMessage(seed) {
  const artistRadio = seed?.type === 'artist' || !seed?.title
  return artistRadio
    ? "Couldn't find songs for this radio. Artist radio uses Last.fm's similar artists: is Last.fm connected (Settings > Integrations)?"
    : "Couldn't find songs for this radio: no similar songs could be found on your playback sources."
}

/**
 * Open the Radio page at once; it builds the radio there, playing its first
 * songs as soon as they're found (pages/Radio.jsx).
 */
export async function openRadio(navigate, seed, userId) {
  if (!seed?.artist && !seed?.title) return false
  navigate('/radio', { state: { seed, name: `${seed.title || seed.artist} Radio`, build: true } })
  return true
}
