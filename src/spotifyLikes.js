// Songs liked on Spotify since likes sync was turned on (Settings →
// Integrations → Spotify → Sync Likes), liked in Lokal too: the main process
// reads them (electron/ipc/spotifyLikes.js); here they're found in the
// library, or online, and liked for the user sync is for. Looked for every
// few minutes and when the window comes back to the front.

import { api } from './api.js'
import { resolveRecommendationTracks } from './recommendations.js'
import { showToast } from './components/Toaster.jsx'

const EVERY_MS = 3 * 60 * 1000
const AT_MOST_EVERY_MS = 45 * 1000 // focusing the window again and again doesn't ask Spotify again and again

let started = false
let timer = null
let running = false
let lastRun = 0

async function look() {
  if (running || Date.now() - lastRun < AT_MOST_EVERY_MS) return
  running = true
  lastRun = Date.now()
  try {
    const status = await Promise.resolve(api.spotifyLikesStatus()).catch(() => null)
    if (!status?.enabled) return
    const { items = [], userId } = await Promise.resolve(api.spotifyLikesPoll()).catch(() => ({ items: [] }))
    if (!items.length) return
    const rows = await resolveRecommendationTracks(items.map(item => ({
      title: item.title, artist: item.artist, album: item.album, duration: item.duration, artwork_url: item.artwork_url, source: 'spotify',
    })), api, { prepareStreams: false }).catch(() => [])
    let liked = 0
    for (const row of rows.filter(Boolean)) {
      const result = await Promise.resolve(api.setLike(row.id, userId || 'guest', true)).catch(() => null)
      if (result?.liked) liked++
    }
    if (liked) showToast(liked === 1 ? 'A song you liked on Spotify is in your Liked Songs' : `${liked} songs you liked on Spotify are in your Liked Songs`)
  } finally {
    running = false
  }
}

/** Starts looking (once per window). */
export function startSpotifyLikesSync() {
  if (started || !api.isElectron) return
  started = true
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { look().finally(schedule) }, EVERY_MS) }
  window.addEventListener('focus', () => { look().catch(() => {}) })
  // Turned on in Settings: a first look right away.
  window.addEventListener('lokal:spotify-likes-changed', () => { lastRun = 0; look().catch(() => {}) })
  setTimeout(() => { look().catch(() => {}).finally(schedule) }, 20 * 1000)
}
