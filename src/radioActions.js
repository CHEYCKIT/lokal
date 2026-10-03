import { api } from './api'
import { streamRef } from './onlineTracks'

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

function songKey(track) {
  return `${normalize(track?.title)}|${normalize(track?.artist)}`
}

function uniqueTracks(tracks) {
  return (Array.isArray(tracks) ? tracks : [])
    .filter(track => track?.id && track?.title)
    .filter((track, index, list) => list.findIndex(item => item.id === track.id || songKey(item) === songKey(track)) === index)
    .slice(0, 50)
}

function overlap(left, right) {
  const a = new Set(normalize(left).split(' ').filter(Boolean))
  const b = new Set(normalize(right).split(' ').filter(Boolean))
  if (!a.size || !b.size) return 0
  return [...a].filter(word => b.has(word)).length / Math.max(a.size, b.size)
}

function matchScore(candidate, result) {
  const wantedTitle = normalize(candidate?.title)
  const wantedArtist = normalize(candidate?.artist)
  const title = normalize(result?.title)
  const artist = normalize(result?.artist || result?.artists?.join(' '))
  if (!wantedTitle || !wantedArtist || !title || !artist) return 0
  let score = 0
  if (title === wantedTitle) score += 6
  else if (title.includes(wantedTitle) || wantedTitle.includes(title)) score += 4
  else if (overlap(wantedTitle, title) >= 0.6) score += 3
  if (artist === wantedArtist) score += 5
  else if (artist.includes(wantedArtist) || wantedArtist.includes(artist)) score += 4
  else if (overlap(wantedArtist, artist) >= 0.6) score += 2
  if (result?.kind === 'song' || result?.official) score += 1
  return score
}

function bestSongMatch(candidate, results) {
  const best = (Array.isArray(results) ? results : [])
    .map(result => ({ result, score: matchScore(candidate, result) }))
    .sort((a, b) => b.score - a.score)[0]
  return best?.score >= 8 ? best.result : null
}

function artistMatches(artist, result) {
  const wanted = normalize(artist)
  const actual = normalize(result?.artist || result?.artists?.join(' '))
  return wanted && actual && (actual === wanted || actual.includes(wanted) || wanted.includes(actual) || overlap(wanted, actual) >= 0.6)
}

async function saveYoutubeResults(items) {
  const valid = (Array.isArray(items) ? items : [])
    .filter(item => item?.id || item?.videoId)
    .map(item => ({ ...item, provider: 'yt', id: item.id || item.videoId, thumbnail: item.thumbnail || item.artwork_url }))
  return valid.length ? api.onlineSave(valid).catch(() => []) : []
}

async function searchAndSaveSongs(candidates) {
  const searches = await Promise.all((Array.isArray(candidates) ? candidates : []).map(async candidate => {
    const query = [candidate.artist, candidate.title].filter(Boolean).join(' ')
    const result = await api.onlineSearch(query, 'yt').catch(() => null)
    const match = bestSongMatch(candidate, result?.results)
    return match ? [match] : []
  }))
  return saveYoutubeResults(searches.flat())
}

async function searchAndSaveArtistSongs(artists) {
  const searches = await Promise.all((Array.isArray(artists) ? artists : []).map(async artist => {
    const result = await api.onlineSearch(artist, 'yt').catch(() => null)
    return (Array.isArray(result?.results) ? result.results : [])
      .filter(item => artistMatches(artist, item))
      .filter(item => item.kind === 'song' || item.official)
      .slice(0, 2)
  }))
  return saveYoutubeResults(searches.flat())
}

async function youtubeRadio(videoId) {
  const radio = await api.youtubeRadio(videoId).catch(() => [])
  return saveYoutubeResults(radio)
}

export async function buildRadio(seed, userId) {
  if (!seed?.artist && !seed?.title) return []
  const mode = seed.type || (!seed.title || normalize(seed.title) === normalize(seed.artist) ? 'artist' : 'track')
  const stream = streamRef(seed)
  let providerSeed = stream?.provider === 'yt' ? seed : null

  // A library track has no YouTube id. Resolve that exact song first so the
  // provider can generate its own radio instead of falling back to local
  // related tracks.
  if (!providerSeed && mode === 'track' && seed.title && seed.artist) {
    const result = await api.onlineSearch(`${seed.artist} ${seed.title}`, 'yt').catch(() => null)
    const match = bestSongMatch(seed, result?.results)
    const [saved] = match ? await saveYoutubeResults([match]) : []
    providerSeed = saved || null
  }

  const providerRadio = providerSeed
    ? await youtubeRadio(streamRef(providerSeed)?.id || stream?.id)
    : []
  const similar = await api.lastfmSimilar(seed.artist, mode === 'track' ? seed.title : null, 32).catch(() => null)
  const similarTracks = mode === 'track' && Array.isArray(similar?.tracks) ? similar.tracks : []
  const similarArtists = mode !== 'track' && Array.isArray(similar?.artists)
    ? similar.artists.map(artist => artist.name).filter(Boolean)
    : []
  const lastfmSongs = similarTracks.length
    ? await searchAndSaveSongs(similarTracks)
    : await searchAndSaveArtistSongs(similarArtists)

  // All recommendations here come from YouTube Music radio or Last.fm
  // similar results. The local library is only the optional seed.
  return uniqueTracks([...(seed.id ? [seed] : []), ...providerRadio, ...lastfmSongs])
}

export async function openRadio(navigate, seed, userId) {
  const tracks = await buildRadio(seed, userId)
  if (!tracks.length) return false
  navigate('/radio', {
    state: {
      tracks,
      name: `${seed.title || seed.artist} Radio`,
      seed,
    },
  })
  return true
}
