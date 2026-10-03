import { api } from './api'
import { streamRef } from './onlineTracks'

function uniqueTracks(tracks) {
  return (Array.isArray(tracks) ? tracks : [])
    .filter(track => track?.id && track?.title)
    .filter((track, index, list) => list.findIndex(item => item.id === track.id) === index)
    .slice(0, 50)
}

export async function buildRadio(seed, userId) {
  if (!seed?.artist && !seed?.title) return []
  let related = seed.id ? await api.getRelated(seed.id, userId).catch(() => []) : []
  const stream = streamRef(seed)
  if (stream?.provider === 'yt') {
    const radio = await api.youtubeRadio(stream.id).catch(() => [])
    const savedRadio = Array.isArray(radio) && radio.length ? await api.onlineSave(radio.map(item => ({ ...item, provider: 'yt', id: item.videoId, thumbnail: item.thumbnail }))).catch(() => []) : []
    if (Array.isArray(savedRadio) && savedRadio.length) related = [...savedRadio, ...(Array.isArray(related) ? related : [])]
  }
  if (!Array.isArray(related) || related.length < 8) {
    const query = seed.artist && seed.title
      ? `${seed.artist} ${seed.title} radio`
      : `${seed.artist || seed.title} similar music radio`
    const result = await api.onlineSearch(query, 'yt').catch(() => null)
    const online = Array.isArray(result?.results) ? result.results.slice(0, 40) : []
    const saved = online.length ? await api.onlineSave(online).catch(() => []) : []
    related = [...(Array.isArray(related) ? related : []), ...(Array.isArray(saved) ? saved : [])]
  }
  return uniqueTracks([...(seed.id ? [seed] : []), ...related])
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
