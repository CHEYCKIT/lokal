// Deezer's public metadata API; playback/download sources remain independent.
const PAGE_SIZE = 100
const MAX_PAGES = 100
const MAX_BYTES = 4 * 1024 * 1024

function playlistId(raw) {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['deezer.com', 'www.deezer.com'].includes(url.hostname)) return null
    return url.pathname.match(/^\/(?:[a-z]{2}\/)?playlist\/(\d+)\/?$/i)?.[1] || null
  } catch { return null }
}

async function requestJson(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`Deezer returned HTTP ${response.status}.`)
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Deezer playlist response is too large.')
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_BYTES) throw new Error('Deezer playlist response is too large.')
        chunks.push(Buffer.from(value))
      }
    } finally { await reader.cancel().catch(() => {}) }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!data || data.error) throw new Error('Deezer could not read this public playlist. It may be private or unavailable.')
    return data
  } finally { clearTimeout(timeout) }
}

async function readPlaylist(raw, { getJson = requestJson } = {}) {
  const id = playlistId(raw)
  if (!id) throw new Error('Paste the full Deezer playlist URL (deezer.com/playlist/…), rather than a shortened share link.')
  const metadata = await getJson(`https://api.deezer.com/playlist/${id}`)
  const tracks = []
  let total = Number(metadata.nb_tracks)
  for (let page = 0; page < MAX_PAGES; page++) {
    // Use our fixed endpoint and offset rather than trusting the next URL.
    const result = await getJson(`https://api.deezer.com/playlist/${id}/tracks?index=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`)
    if (!Array.isArray(result.data)) throw new Error('Deezer returned invalid playlist tracks.')
    if (Number.isFinite(Number(result.total))) total = Number(result.total)
    for (const track of result.data) {
      if (!track || !String(track.title || '').trim()) continue
      tracks.push({ id: track.id, name: track.title, artists: track.artist?.name || '', album: track.album?.title || null,
        duration_ms: Number(track.duration) > 0 ? Number(track.duration) * 1000 : null,
        source_url: track.id ? `https://www.deezer.com/track/${track.id}` : null })
    }
    if (!result.next || !result.data.length) {
      if (Number.isFinite(total) && tracks.length < total) throw new Error(`Deezer returned only ${tracks.length} of ${total} songs. Try syncing again.`)
      return { name: metadata.title || 'Deezer Playlist', tracks }
    }
  }
  // Do not mutate sync history when the remote listing is incomplete.
  throw new Error('This Deezer playlist exceeds the sync limit of 10000 songs.')
}

module.exports = { playlistId, readPlaylist, requestJson }
