// A music video's animated preview (the few seconds YouTube plays when you
// point at a video on its site), for the Videos page's cards when the video
// isn't downloaded. One YouTube search per video (never yt-dlp, never the
// video itself), one at a time, remembered for a while: a found preview for
// six hours (its link stops working at some point; the card then skips it and
// the next look asks again), "none" for a day. A video YouTube shows no
// animated preview for keeps its still thumbnail: no slideshow stand-in.
// The same youtube.com search serves the music video lookup (searchVideos).

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const SESSION_TTL_MS = 6 * 60 * 60 * 1000
const FOUND_TTL_MS = 6 * 60 * 60 * 1000
const NONE_TTL_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 10000
const VIDEO_ID = /^[\w-]{11}$/

const remembered = new Map() // videoId -> { url, at }
let session = null // { clientVersion, visitor, at }
let queue = Promise.resolve()

async function fetchText(fetchImpl, url, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal })
    if (!res.ok) throw new Error(`YouTube answered ${res.status}`)
    return await res.text()
  } finally { clearTimeout(timer) }
}

/** YouTube only sends animated previews to a current web client with a visitor id. */
async function webSession(fetchImpl, now) {
  if (session && now() - session.at < SESSION_TTL_MS) return session
  const page = await fetchText(fetchImpl, 'https://www.youtube.com/?hl=en', { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.8' } })
  const clientVersion = page.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1]
  const visitor = page.match(/"VISITOR_DATA":"([^"]+)"/)?.[1]
  if (!clientVersion) throw new Error('YouTube gave no client version')
  session = { clientVersion, visitor: visitor || '', at: now() }
  return session
}

/** The animated preview's address for `videoId` in a search response, or null. */
function movingThumbnail(response, videoId) {
  let found = null
  const walk = node => {
    if (found || !node || typeof node !== 'object') return
    if (node.videoRenderer?.videoId === videoId) {
      const thumbnails = node.videoRenderer.richThumbnail?.movingThumbnailRenderer?.movingThumbnailDetails?.thumbnails || []
      const best = [...thumbnails].filter(t => /^https:\/\/i\d*\.ytimg\.com\//.test(String(t?.url || ''))).sort((a, b) => (b.width || 0) - (a.width || 0))[0]
      found = best ? best.url : ''
      return
    }
    for (const value of Object.values(node)) walk(value)
  }
  walk(response)
  return found || null
}

async function lookUp(videoId, query, fetchImpl, now) {
  const { clientVersion, visitor } = await webSession(fetchImpl, now)
  const body = JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US', visitorData: visitor, userAgent: UA } }, query })
  const text = await fetchText(fetchImpl, 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA, ...(visitor ? { 'x-goog-visitor-id': visitor } : {}) },
    body,
  })
  return movingThumbnail(JSON.parse(text), videoId)
}

/**
 * `videoId`'s animated preview (an https image address), or null when
 * YouTube has none for it. `query` finds it (the video's title, or the song's
 * artist and title); `force` asks again (the remembered link stopped working).
 */
function animatedPreview(videoId, query, { fetchImpl = (...a) => fetch(...a), now = Date.now, force = false } = {}) {
  if (!VIDEO_ID.test(String(videoId || ''))) return Promise.resolve(null)
  const text = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!text) return Promise.resolve(null)
  const hit = remembered.get(videoId)
  if (!force && hit && now() - hit.at < (hit.url ? FOUND_TTL_MS : NONE_TTL_MS)) return Promise.resolve(hit.url)
  // One search at a time: skimming the page never sends a burst.
  const job = queue.then(async () => {
    const again = remembered.get(videoId)
    if (!force && again && now() - again.at < (again.url ? FOUND_TTL_MS : NONE_TTL_MS)) return again.url
    let url = null
    try { url = await lookUp(videoId, text, fetchImpl, now) } catch { return null } // offline: ask again next time
    if (remembered.size > 500) remembered.delete(remembered.keys().next().value)
    remembered.set(videoId, { url, at: now() })
    return url
  })
  queue = job.catch(() => {})
  return job
}

/** "3:45" / "1:02:03" -> seconds, or null. */
function seconds(text) {
  const parts = String(text || '').split(':').map(Number)
  if (!parts.length || parts.some(n => !Number.isFinite(n))) return null
  return parts.reduce((total, n) => total * 60 + n, 0)
}

/** The videos in a youtube.com search response: { id, title, channel, duration, url }. */
function searchResults(response) {
  const found = []
  const walk = node => {
    if (!node || typeof node !== 'object') return
    const video = node.videoRenderer
    if (video?.videoId && VIDEO_ID.test(video.videoId)) {
      found.push({
        id: video.videoId,
        title: video.title?.runs?.map(run => run.text).join('') || video.title?.simpleText || '',
        channel: video.ownerText?.runs?.[0]?.text || video.longBylineText?.runs?.[0]?.text || '',
        duration: seconds(video.lengthText?.simpleText),
        url: `https://www.youtube.com/watch?v=${video.videoId}`,
      })
      return
    }
    for (const value of Object.values(node)) walk(value)
  }
  walk(response)
  return found
}

/**
 * A youtube.com search, the same one a browser makes (the music video lookup
 * uses it instead of a yt-dlp search: a request, not a program started).
 * Throws when YouTube can't be reached.
 */
async function searchVideos(query, { fetchImpl = (...a) => fetch(...a), now = Date.now } = {}) {
  const text = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!text) return []
  const { clientVersion, visitor } = await webSession(fetchImpl, now)
  const body = JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US', visitorData: visitor, userAgent: UA } }, query: text })
  const response = await fetchText(fetchImpl, 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA, ...(visitor ? { 'x-goog-visitor-id': visitor } : {}) },
    body,
  })
  return searchResults(JSON.parse(response))
}

function forget() { remembered.clear(); session = null; queue = Promise.resolve() }

module.exports = { animatedPreview, movingThumbnail, searchVideos, searchResults, forget }
