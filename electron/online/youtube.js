// Online results from YouTube Music, streamed with the user's own yt-dlp:
// the same source the downloader already uses, played instead of saved.
// Shared by the desktop app (IPC + the lokal-stream:// protocol) and the web
// server (/api/online).
//
//   - search: YouTube Music's own search (the "Songs" tab), so results carry
//     the artist, album, duration and square cover art;
//   - stream: yt-dlp works out the audio URL (Opus when there is one), cached
//     until shortly before it expires, and fetched again once if YouTube
//     refuses it (an expired or IP-bound URL);
//   - keeping online songs as ghost tracks (for playlists, likes, history)
//     is shared with the other sources: see sources.js.

const { spawn } = require('child_process')
const crypto = require('crypto')
const { isCookieError, markUnreadable } = require('../ipc/ytCookies')

const SEARCH_URL = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false'
const CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20250901.03.00', hl: 'en' }
// YouTube Music's "Songs" filter, as its own web client sends it.
const SONGS_PARAMS = 'EgWKAQIIAWoOEAkQAxAEEAUQChAVEA4%3D'
const VIDEO_ID = /^[\w-]{11}$/
const DURATION = /^(?:\d+:)?\d{1,2}:\d{2}$/
const SEARCH_TTL_MS = 10 * 60 * 1000
const STREAM_MARGIN_MS = 10 * 60 * 1000
const RESOLVE_TIMEOUT_MS = 30000
const BROWSE_URL = 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false'
const LIKE_URL = 'https://music.youtube.com/youtubei/v1/like'
const ACCOUNT_TTL_MS = 5 * 60 * 1000

const searchCache = new Map() // query -> { at, results }
const streamCache = new Map() // videoId -> { url, headers, mime, expiresAt }
const resolving = new Map()   // videoId -> Promise
const accountCache = new Map() // cookie fingerprint -> { at, data }
const contextCache = new Map()

/** "3:07" or "1:02:03" -> seconds; null when it isn't a duration. */
function parseDuration(text) {
  if (!DURATION.test(String(text || '').trim())) return null
  return String(text).trim().split(':').map(Number).reduce((total, part) => total * 60 + part, 0)
}

/** The runs (text pieces) of one flex column of a list item. */
function columnRuns(renderer, index) {
  return renderer?.flexColumns?.[index]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []
}

/** A bigger square cover than the 60px one in search results. */
function largerThumbnail(url) {
  if (!url) return null
  return /=w\d+-h\d+/.test(url) ? url.replace(/=w\d+-h\d+[^&?]*$/, '=w544-h544-l90-rj') : url
}

/** One song or video row of a YouTube Music search, or null for anything else. */
function parseItem(renderer) {
  const titleRuns = columnRuns(renderer, 0)
  const watch = titleRuns[0]?.navigationEndpoint?.watchEndpoint || renderer?.navigationEndpoint?.watchEndpoint
  const videoId = renderer?.playlistItemData?.videoId || watch?.videoId
  if (!videoId || !VIDEO_ID.test(videoId)) return null
  const videoType = watch?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType || ''

  const artists = []
  let album = null
  let albumId = null
  let duration = null
  const loose = []
  for (const run of columnRuns(renderer, 1)) {
    const text = String(run.text || '').trim()
    if (!text || text === '•') continue
    const browse = run.navigationEndpoint?.browseEndpoint
    const pageType = browse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || ''
    if (pageType.endsWith('_ARTIST') || pageType.endsWith('_USER_CHANNEL')) artists.push(text)
    else if (pageType.endsWith('_ALBUM')) { album = text; albumId = browse.browseId || null }
    else if (parseDuration(text) != null) duration = parseDuration(text)
    else loose.push(text)
  }
  // Unfiltered results start with the kind ("Song", "Video"); an artist
  // without a channel link is plain text.
  const kind = /^(song|video|episode)$/i.test(loose[0] || '') ? loose.shift().toLowerCase() : null
  if (kind === 'episode') return null
  if (!artists.length) {
    const name = loose.find(t => !/\b(views|plays)$/i.test(t))
    if (name) artists.push(name)
  }
  if (!album) {
    album = loose.find(text => !artists.includes(text) && parseDuration(text) == null && !/\b(views|plays)$/i.test(text)) || null
  }

  const thumbs = renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || []
  return {
    videoId,
    title: titleRuns.map(r => r.text).join('').trim(),
    artists,
    artist: artists.join(', '),
    album,
    albumId,
    duration,
    thumbnail: largerThumbnail(thumbs[thumbs.length - 1]?.url),
    // ATV = the audio track from the catalogue; OMV = official music video.
    kind: kind || (videoType === 'MUSIC_VIDEO_TYPE_ATV' ? 'song' : 'video'),
    official: videoType === 'MUSIC_VIDEO_TYPE_ATV' || videoType === 'MUSIC_VIDEO_TYPE_OMV',
    url: `https://music.youtube.com/watch?v=${videoId}`,
  }
}

/** Every song/video row in a search response, in order, without repeats. */
function parseSearch(json) {
  const found = []
  const seen = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.musicResponsiveListItemRenderer) {
      const item = parseItem(node.musicResponsiveListItemRenderer)
      if (item && !seen.has(item.videoId)) { seen.add(item.videoId); found.push(item) }
      return
    }
    for (const value of Object.values(node)) walk(value)
  }
  walk(json)
  return found
}

async function innertubeSearch(query, params, fetchImpl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetchImpl(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ context: { client: CLIENT }, query, ...(params ? { params } : {}) }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`YouTube Music answered ${res.status}`)
    return parseSearch(await res.json())
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Songs on YouTube Music for `query`: the Songs tab, or, where YouTube Music
 * has no catalogue for the region, the songs and official videos of the
 * general search. Cached for ten minutes.
 */
async function searchSongs(query, { limit = 10, fetchImpl = fetch } = {}) {
  const q = String(query || '').trim()
  if (q.length < 2) return []
  const key = q.toLowerCase()
  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.results.slice(0, limit)
  let results = await innertubeSearch(q, SONGS_PARAMS, fetchImpl)
  if (!results.length) {
    const all = await innertubeSearch(q, null, fetchImpl)
    results = all.filter(r => r.kind === 'song' || r.official)
  }
  if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value)
  searchCache.set(key, { at: Date.now(), results })
  return results.slice(0, limit)
}

// -------------------------------------------------------------- account data

function cookieValue(header, names) {
  const values = new Map()
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    values.set(part.slice(0, index).trim(), part.slice(index + 1).trim())
  }
  return names.map(name => values.get(name)).find(Boolean) || ''
}

const { normalizeCookies: normalizeAccountCookies, browserContext } = require('./browserAuth')

function accountHeaders(cookieHeader, config = {}) {
  config = { ...config, ...browserContext(cookieHeader) }
  cookieHeader = normalizeAccountCookies(cookieHeader)
  const sapisid = cookieValue(cookieHeader, ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID'])
  if (!sapisid) return null
  const timestamp = Math.floor(Date.now() / 1000)
  const signed = (scheme, value) => `${scheme} ${timestamp}_${crypto.createHash('sha1').update(`${timestamp} ${value} https://music.youtube.com`).digest('hex')}`
  const authorization = [signed('SAPISIDHASH', sapisid)]
  for (const [scheme, name] of [['SAPISID1PHASH', '__Secure-1PAPISID'], ['SAPISID3PHASH', '__Secure-3PAPISID']]) {
    const value = cookieValue(cookieHeader, [name])
    if (value) authorization.push(signed(scheme, value))
  }
  // Some exported sessions contain only the secure counterpart. The account
  // API still expects its SAPISID cookie alongside the authorization hash.
  if (!cookieValue(cookieHeader, ['SAPISID'])) cookieHeader += `; SAPISID=${sapisid}`
  return {
    'Content-Type': 'application/json',
    Origin: 'https://music.youtube.com',
    Referer: 'https://music.youtube.com/',
    'User-Agent': config.USER_AGENT || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    Cookie: cookieHeader,
    Authorization: authorization.join(' '),
    'X-Origin': 'https://music.youtube.com',
    'X-YouTube-Client-Name': '67',
    'X-YouTube-Client-Version': config.INNERTUBE_CLIENT_VERSION || CLIENT.clientVersion,
    'X-Goog-AuthUser': String(config.SESSION_INDEX || '0'),
    ...(config.VISITOR_DATA ? { 'X-Goog-Visitor-Id': config.VISITOR_DATA } : {}),
    ...(config.DELEGATED_SESSION_ID ? { 'X-Goog-PageId': config.DELEGATED_SESSION_ID } : {}),
  }
}

function parseMusicConfig(html) {
  const marker = /ytcfg\.set\(\s*\{/g
  let match
  while ((match = marker.exec(String(html || '')))) {
    const start = marker.lastIndex - 1
    let quoted = false, escaped = false, depth = 0
    for (let at = start; at < html.length; at++) {
      const char = html[at]
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue }
      if (char === '"') quoted = true
      else if (char === '{') depth++
      else if (char === '}' && --depth === 0) {
        try { const config = JSON.parse(html.slice(start, at + 1)); if (config.INNERTUBE_CLIENT_VERSION) return config } catch {}
        break
      }
    }
  }
  return {}
}

async function musicContext(cookieHeader, fetchImpl, force = false) {
  const id = accountKey(cookieHeader)
  const cached = contextCache.get(id)
  if (!force && cached && Date.now() - cached.at < ACCOUNT_TTL_MS) return cached.config
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetchImpl('https://music.youtube.com/', { headers: { Cookie: normalizeAccountCookies(cookieHeader), 'User-Agent': browserContext(cookieHeader).USER_AGENT || 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' }, signal: controller.signal })
    const config = { ...(res.ok ? parseMusicConfig(await res.text()) : {}), ...browserContext(cookieHeader) }
    contextCache.set(id, { config, at: Date.now() })
    if (contextCache.size > 4) contextCache.delete(contextCache.keys().next().value)
    return config
  } catch { return {} }
  finally { clearTimeout(timer) }
}

function textOf(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value.simpleText) return String(value.simpleText)
  if (Array.isArray(value.runs)) return value.runs.map(run => String(run.text || '')).join('')
  return ''
}

function thumbnailsOf(value) {
  const thumbnails = value?.thumbnails || value?.musicThumbnailRenderer?.thumbnail?.thumbnails || []
  return Array.isArray(thumbnails) && thumbnails.length ? largerThumbnail(thumbnails[thumbnails.length - 1].url) : null
}

function walkObjects(root, visitor) {
  if (!root || typeof root !== 'object') return
  if (Array.isArray(root)) {
    root.forEach(item => walkObjects(item, visitor))
    return
  }
  visitor(root)
  Object.values(root).forEach(value => walkObjects(value, visitor))
}

function parseTrackCard(renderer) {
  const videoId = renderer?.navigationEndpoint?.watchEndpoint?.videoId
    || renderer?.onTap?.watchEndpoint?.videoId
    || ''
  const title = textOf(renderer?.title)
  const subtitle = textOf(renderer?.subtitle)
  if (!VIDEO_ID.test(videoId) || !title) return null
  const subtitleParts = subtitle.split('•').map(value => value.trim()).filter(Boolean)
  const artist = subtitleParts[0] || 'Unknown Artist'
  return {
    videoId,
    title,
    artists: [artist],
    artist,
    album: subtitleParts[1] || null,
    duration: null,
    thumbnail: thumbnailsOf(renderer?.thumbnail),
    kind: 'song',
    official: true,
    url: `https://music.youtube.com/watch?v=${videoId}`,
  }
}

function parseAccountTracks(root, limit = 200) {
  const tracks = []
  const seen = new Set()
  walkObjects(root, node => {
    const renderer = node.musicResponsiveListItemRenderer
    if (!renderer || tracks.length >= limit) return
    const item = parseItem(renderer)
    if (!item || seen.has(item.videoId)) return
    seen.add(item.videoId)
    tracks.push(item)
    return
  })
  walkObjects(root, node => {
    if (tracks.length >= limit) return
    const panel = node.playlistPanelVideoRenderer
    const item = panel ? {
      videoId: panel.videoId, title: textOf(panel.title), artist: textOf(panel.longBylineText || panel.shortBylineText).split(' • ')[0],
      thumbnail: thumbnailsOf(panel.thumbnail), duration: parseDuration(textOf(panel.lengthText)),
      url: `https://music.youtube.com/watch?v=${panel.videoId}`,
    } : parseTrackCard(node.musicTwoRowItemRenderer)
    if (item && (!VIDEO_ID.test(item.videoId || '') || !item.title || !item.artist)) return
    if (!item || seen.has(item.videoId)) return
    seen.add(item.videoId)
    tracks.push(item)
  })
  return tracks
}

function parseAccountPlaylists(root, limit = 100) {
  const playlists = []
  const seen = new Set()
  walkObjects(root, node => {
    const renderer = node.gridPlaylistRenderer || node.musicTwoRowItemRenderer
    if (!renderer || playlists.length >= limit) return
    const endpoint = renderer.navigationEndpoint?.browseEndpoint
    const rawId = renderer.playlistId || endpoint?.browseId || ''
    const id = String(rawId).replace(/^VL/, '')
    if (!id || /^UC|^MPRE/.test(id) || seen.has(id)) return
    const title = textOf(renderer.title)
    if (!title) return
    seen.add(id)
    playlists.push({
      id,
      title,
      author: textOf(renderer.shortBylineText || renderer.subtitle),
      trackCount: textOf(renderer.videoCountText || renderer.secondLine),
      thumbnail: thumbnailsOf(renderer.thumbnail),
      url: `https://music.youtube.com/playlist?list=${encodeURIComponent(id)}`,
    })
  })
  return playlists
}

function parseAccountEntities(root, type) {
  const items = new Map()
  walkObjects(root, node => {
    const row = node.musicTwoRowItemRenderer || node.musicResponsiveListItemRenderer
    const titleRuns = columnRuns(row, 0)
    const endpoint = row?.navigationEndpoint?.browseEndpoint || titleRuns[0]?.navigationEndpoint?.browseEndpoint
    const pageType = endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || ''
    const title = textOf(row?.title) || titleRuns.map(run => run.text).join('')
    if (!title || !pageType.endsWith(type === 'artist' ? '_ARTIST' : '_ALBUM')) return
    const image = thumbnailsOf(row.thumbnail)
    const artist = (textOf(row.subtitle) || columnRuns(row, 1).map(run => run.text).join('')).split('•').map(value => value.trim()).find(value => value && !/^(album|single|ep|\d{4})$/i.test(value)) || ''
    items.set(endpoint.browseId, type === 'artist' ? { name: title, image, browseId: endpoint.browseId } : { title, artist, artwork_url: image, albumId: endpoint.browseId })
  })
  return [...items.values()].slice(0, 30)
}

async function accountBrowse(browseId, cookieHeader, fetchImpl = fetch, config = {}, { anonymous = false } = {}) {
  const headers = accountHeaders(cookieHeader, config) || (anonymous ? { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com' } : null)
  if (!headers) throw new Error('Sign in to YouTube Music in Integrations.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetchImpl(BROWSE_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ context: { client: { ...CLIENT, ...config.INNERTUBE_CONTEXT?.client, clientVersion: config.INNERTUBE_CLIENT_VERSION || CLIENT.clientVersion, ...(config.VISITOR_DATA ? { visitorData: config.VISITOR_DATA } : {}) }, user: { ...(config.DELEGATED_SESSION_ID ? { onBehalfOfUser: config.DELEGATED_SESSION_ID } : {}) } }, browseId }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`YouTube Music account request failed (${res.status}).`)
    const json = await res.json()
    if (!anonymous && isLoggedOutResponse(json)) {
      throw new Error('YouTube Music rejected the saved session. Sign in again in Integrations.')
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

function accountKey(cookieHeader) {
  return crypto.createHash('sha256').update(String(cookieHeader || '')).digest('hex').slice(0, 24)
}

function isLoggedOutResponse(json) {
  const login = (json?.responseContext?.serviceTrackingParams || []).flatMap(service => Array.isArray(service?.params) ? service.params : []).filter(param => param?.key === 'logged_in')
  if (json?.responseContext?.mainAppWebResponseContext?.loggedOut === true) return true
  // Tracking services can disagree; any authenticated service is evidence of
  // login, rather than rejecting an otherwise valid account response.
  return login.length > 0 && !login.some(param => String(param.value) === '1') && login.some(param => String(param.value) === '0')
}

/** Authenticated YouTube Music account surfaces backed by the internal login. */
async function fetchAccountData({ cookies, fetchImpl = fetch, limit = 100, force = false } = {}) {
  const cookieHeader = String(cookies || '')
  if (!accountHeaders(cookieHeader)) return { error: 'Sign in to YouTube Music in Integrations.', authenticated: false }
  const key = accountKey(cookieHeader)
  const cached = accountCache.get(key)
  if (!force && cached && Date.now() - cached.at < ACCOUNT_TTL_MS) return cached.data

  const config = await musicContext(cookieHeader, fetchImpl, force)
  const [likedResult, playlistsResult, homeResult, historyResult] = await Promise.allSettled([
    accountBrowse('VLLM', cookieHeader, fetchImpl, config),
    accountBrowse('FEmusic_liked_playlists', cookieHeader, fetchImpl, config),
    accountBrowse('FEmusic_home', cookieHeader, fetchImpl, config),
    accountBrowse('FEmusic_history', cookieHeader, fetchImpl, config),
  ])
  const liked = likedResult.status === 'fulfilled' ? parseAccountTracks(likedResult.value, limit) : []
  const playlists = playlistsResult.status === 'fulfilled' ? parseAccountPlaylists(playlistsResult.value, limit) : []
  const home = homeResult.status === 'fulfilled' ? parseAccountTracks(homeResult.value, limit) : []
  const results = [likedResult, playlistsResult, homeResult, historyResult]
  const errors = results.filter(result => result.status === 'rejected')
  const authenticated = results.some(result => result.status === 'fulfilled' && (result.value?.responseContext?.mainAppWebResponseContext?.loggedOut === false || (result.value?.responseContext?.serviceTrackingParams || []).some(service => (service.params || []).some(param => param.key === 'logged_in' && String(param.value) === '1'))))
  if (!authenticated) {
    return { error: errors[0]?.reason?.message || 'YouTube Music did not confirm an authenticated account. Sign in again in Integrations.', authenticated: false }
  }
  const homePlaylists = homeResult.status === 'fulfilled' ? parseAccountPlaylists(homeResult.value, 12) : []
  const data = { liked, playlists, home, homePlaylists, history: historyResult.status === 'fulfilled' ? parseAccountTracks(historyResult.value, limit) : [], artists: homeResult.status === 'fulfilled' ? parseAccountEntities(homeResult.value, 'artist') : [], albums: homeResult.status === 'fulfilled' ? parseAccountEntities(homeResult.value, 'album') : [], authenticated: true, homeError: homeResult.status === 'rejected' ? homeResult.reason?.message : '' }
  if (!errors.length) {
    accountCache.set(key, { at: Date.now(), data })
    if (accountCache.size > 4) accountCache.delete(accountCache.keys().next().value)
  }
  return data
}

/** YouTube Music's own song radio, rather than searching for the word "radio". */
async function fetchRadio(videoId, { cookies = '', fetchImpl = fetch, limit = 50 } = {}) {
  if (!VIDEO_ID.test(String(videoId || ''))) return []
  const config = await musicContext(cookies, fetchImpl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetchImpl('https://music.youtube.com/youtubei/v1/next?prettyPrint=false', {
      method: 'POST', signal: controller.signal,
      headers: accountHeaders(cookies, config) || { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com' },
      body: JSON.stringify({ context: { client: { ...CLIENT, clientVersion: config.INNERTUBE_CLIENT_VERSION || CLIENT.clientVersion }, user: config.DELEGATED_SESSION_ID ? { onBehalfOfUser: config.DELEGATED_SESSION_ID } : {} }, videoId, playlistId: `RDAMVM${videoId}`, isAudioOnly: true, enablePersistentPlaylistPanel: true }),
    })
    if (!response.ok) throw new Error(`YouTube Music radio failed (${response.status}).`)
    const json = await response.json()
    return parseAccountTracks(json, limit)
  } finally { clearTimeout(timer) }
}

function clearAccountCache() {
  accountCache.clear()
  contextCache.clear()
  streamCache.clear()
}

async function fetchAccountPlaylist(playlistId, cookies, fetchImpl = fetch) {
  const id = String(playlistId || '').replace(/^VL/, '')
  if (!id) return { error: 'A YouTube Music playlist id is required.' }
  try {
    const config = await musicContext(cookies, fetchImpl)
    const root = await accountBrowse(`VL${id}`, cookies, fetchImpl, config)
    return { id, tracks: parseAccountTracks(root, 500) }
  } catch (error) {
    return { error: error.message }
  }
}

async function fetchCatalogue({ type, artist, album, albumId } = {}, cookies, fetchImpl = fetch) {
  const plain = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (!artist || (type === 'album' && !album)) return { error: 'An artist and album name are required.' }
  if (type !== 'album') {
    const tracks = (await searchSongs(String(artist), { limit: 60, fetchImpl })).filter(track => track.artists.some(name => plain(name) === plain(artist)))
    return { tracks }
  }
  const config = await musicContext(cookies, fetchImpl)
  let id = /^MPRE[\w-]+$/.test(String(albumId || '')) ? albumId : null
  if (!id) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      const response = await fetchImpl(SEARCH_URL, {
        method: 'POST', signal: controller.signal,
        headers: accountHeaders(cookies, config) || { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com' },
        body: JSON.stringify({ context: { client: { ...CLIENT, clientVersion: config.INNERTUBE_CLIENT_VERSION || CLIENT.clientVersion } }, query: `${artist} ${album}`, params: 'EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D' }),
      })
      if (!response.ok) return { error: `YouTube album search failed (${response.status}).` }
      const result = await response.json()
      const match = parseAccountEntities(result, 'album').find(item => plain(item.title) === plain(album) && plain(item.artist) === plain(artist))
      id = match?.albumId
    } finally { clearTimeout(timer) }
  }
  if (!id) return { error: `YouTube Music did not find the album ${album} by ${artist}.` }
  const root = await accountBrowse(id, cookies, fetchImpl, config, { anonymous: !accountHeaders(cookies) })
  return { tracks: parseAccountTracks(root, 100).map(track => {
    const artists = track.artists?.length ? track.artists : [track.artist || String(artist)]
    return { ...track, artists, artist: track.artist || artists.join(', '), album }
  }) }
}

async function setAccountLiked(videoId, liked, cookies, fetchImpl = fetch) {
  if (!VIDEO_ID.test(String(videoId || ''))) return { error: 'Invalid YouTube track id.' }
  const headers = accountHeaders(cookies)
  if (!headers) return { skipped: true }
  const endpoint = liked ? 'like' : 'removelike'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetchImpl(`${LIKE_URL}/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ context: { client: CLIENT }, target: { videoId } }),
      signal: controller.signal,
    })
    if (!res.ok) return { error: `YouTube Music like request failed (${res.status}).` }
    const body = await res.json().catch(() => null)
    if (!body || typeof body !== 'object') return { error: 'YouTube Music returned an invalid like response.' }
    if (isLoggedOutResponse(body)) return { error: 'YouTube Music returned a signed-out response.' }
    accountCache.clear()
    return { ok: true, liked: !!liked }
  } catch (error) {
    return { error: error.message || 'YouTube Music like request failed.' }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------- streams

function expiryOf(url) {
  try {
    const expire = Number(new URL(url).searchParams.get('expire'))
    if (expire > 0) return expire * 1000 - STREAM_MARGIN_MS
  } catch {}
  return Date.now() + 60 * 60 * 1000
}

/** A readable reason from yt-dlp's error output. */
function streamError(text) {
  if (/confirm you.re not a bot/i.test(text)) return 'YouTube asked to confirm you are not a bot. Sign in to YouTube Music in Settings → Integrations.'
  if (/Sign in to confirm your age/i.test(text)) return 'This song is age-restricted. Sign in to YouTube Music in Settings → Integrations to play it.'
  if (/not available|unavailable|Private video|removed/i.test(text)) return 'This song is not available on YouTube.'
  if (/HTTP Error 429|Too Many Requests/i.test(text)) return 'YouTube is rate-limiting. Try again in a while.'
  const line = String(text).split('\n').reverse().find(l => /ERROR:/.test(l))
  return line ? line.replace(/^.*?ERROR:\s*/, '').slice(0, 200) : 'Could not get the audio from YouTube.'
}

// Streaming quality (Settings → Library → Streaming Quality):
//   best   the highest bitrate: Opus ~160 kbps, or Premium's 256 kbps AAC
//          when the cookies are a YouTube Premium account's (-S abr, since
//          yt-dlp would otherwise prefer Opus over AAC whatever the bitrate)
//   saver  the smallest Opus stream (~50-70 kbps)
const QUALITY_ARGS = {
  // Direct HTTP(S) formats only, fallbacks included: the player can't use HLS
  // or DASH manifests, so none of them may pick one. The last resort is a
  // direct file with audio in it (a small muxed video) rather than a manifest.
  best: ['-f', 'bestaudio[protocol=https]/bestaudio[protocol=http]/best[acodec!=none][protocol=https]', '-S', 'abr'],
  saver: ['-f', 'worstaudio[acodec=opus][protocol=https]/worstaudio[protocol=https]/worstaudio[protocol=http]/worst[acodec!=none][protocol=https]'],
}

function runResolve(videoId, { ytdlp, cookieArgs = [], quality = 'best' }) {
  return new Promise((resolve, reject) => {
    const args = [
      ...(QUALITY_ARGS[quality] || QUALITY_ARGS.best),
      '-j', '--no-playlist', '--no-warnings', '--skip-download',
      ...cookieArgs,
      `https://music.youtube.com/watch?v=${videoId}`,
    ]
    let proc
    try { proc = spawn(ytdlp, args, { windowsHide: true }) } catch (e) { reject(new Error(`Could not run yt-dlp (${e.message})`)); return }
    let out = ''
    let err = ''
    const timer = setTimeout(() => { try { proc.kill() } catch {} }, RESOLVE_TIMEOUT_MS)
    proc.stdout.on('data', d => { out += d })
    proc.stderr.on('data', d => { err += d })
    proc.on('error', e => { clearTimeout(timer); reject(new Error(`Could not run yt-dlp (${e.message})`)) })
    proc.on('close', () => {
      clearTimeout(timer)
      let info = null
      try { info = JSON.parse(out.trim().split('\n').pop()) } catch {}
      const output = err || out
      if (!info?.url) {
        if (isCookieError(output)) {
          const error = new Error('YouTube cookies could not be read')
          error.cookieError = true
          reject(error)
          return
        }
        reject(new Error(streamError(output)))
        return
      }
      const ext = info.ext || ''
      resolve({
        format: [info.acodec, info.abr ? `${Math.round(info.abr)} kbps` : null].filter(Boolean).join(' ') || null,
        url: info.url,
        headers: info.http_headers || {},
        mime: ext === 'webm' ? 'audio/webm' : ext === 'm4a' || ext === 'mp4' ? 'audio/mp4' : 'audio/*',
        expiresAt: expiryOf(info.url),
      })
    })
  })
}

/** The audio URL for a video, from cache or yt-dlp (one lookup at a time per video). */
async function resolveStream(videoId, { ytdlp, cookieArgs, cookieBrowser = null, force = false, quality = 'best' } = {}) {
  if (!VIDEO_ID.test(String(videoId || ''))) throw new Error('Not a YouTube video id')
  if (!ytdlp) throw new Error('yt-dlp is not installed. Install it from the Download page.')
  const q = QUALITY_ARGS[quality] ? quality : 'best'
  const key = `${videoId}\n${q}` // a quality change looks the stream up again
  const cached = streamCache.get(key)
  if (!force && cached && cached.expiresAt > Date.now()) return cached
  if (!force && resolving.has(key)) return resolving.get(key)
  const job = (async () => {
    try {
      return await runResolve(videoId, { ytdlp, cookieArgs, quality: q })
    } catch (e) {
      if (!cookieBrowser || !e.cookieError) throw e
      markUnreadable(cookieBrowser)
      return runResolve(videoId, { ytdlp, cookieArgs: [], quality: q })
    }
  })().then(stream => {
    if (streamCache.size > 200) streamCache.delete(streamCache.keys().next().value)
    streamCache.set(key, stream)
    return stream
  })
    .finally(() => resolving.delete(key))
  resolving.set(key, job)
  return job
}

/**
 * Fetch (a range of) the audio for a video. A refused URL (expired, or tied
 * to another address) is looked up again once.
 */
async function fetchStream(videoId, { range, ytdlp, cookieArgs, cookieBrowser, fetchImpl = fetch } = {}) {
  const attempt = async (force) => {
    const stream = await resolveStream(videoId, { ytdlp, cookieArgs, cookieBrowser, force })
    const headers = { ...stream.headers }
    if (range) headers.Range = range
    return { stream, res: await fetchImpl(stream.url, { headers }) }
  }
  let { stream, res } = await attempt(false)
  if (res.status === 403 || res.status === 410) {
    try { await res.body?.cancel?.() } catch {}
    ;({ stream, res } = await attempt(true))
  }
  return { res, mime: stream.mime }
}

/** A YouTube video id from a youtube.com / music.youtube.com / youtu.be link, or null. */
function videoIdFromUrl(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([\w-]{11})/)
  return m ? m[1] : null
}

module.exports = {
  searchSongs, parseSearch, parseItem, parseDuration,
  fetchAccountData, fetchAccountPlaylist, setAccountLiked, fetchCatalogue,
  fetchRadio, parseAccountTracks, clearAccountCache, accountHeaders, normalizeAccountCookies, parseMusicConfig, isLoggedOutResponse,
  resolveStream, fetchStream, streamError, videoIdFromUrl,
}
