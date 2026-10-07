const { buildActivity, artworkUrl } = require('../discord/activity')

let rpcClient = null
let connectionGeneration = 0
let latestPlayback = null
const artworkCache = new Map()
const artworkPending = new Map()

let keepCommaArtistsCache = null
const DEFAULT_DISCORD_CLIENT_ID = '1473597925581131919'

function getFirstArtist(artistString) {
  if (!artistString) return null
  
  if (!keepCommaArtistsCache) {
    try {
      const { getDB } = require('./db')
      const db = getDB()
      const setting = db.prepare("SELECT value FROM settings WHERE key = 'keep_comma_artists'").get()
      keepCommaArtistsCache = setting?.value ? JSON.parse(setting.value) : []
    } catch {
      keepCommaArtistsCache = []
    }
  }
  
  const keepComma = new Set([
    'Tyler, The Creator', 'Earth, Wind & Fire', 'Crosby, Stills & Nash',
    'Crosby, Stills, Nash & Young', 'Simon & Garfunkel', 'Emerson, Lake & Palmer',
    'Syd Barrett', 'Pete & Bas', 'Pe & Ne',
    ...keepCommaArtistsCache
  ])
  
  const lower = artistString.toLowerCase().trim()
  for (const known of keepComma) {
    if (lower === known.toLowerCase() || lower.startsWith(known.toLowerCase() + ' ') || lower.endsWith(' ' + known.toLowerCase())) {
      return artistString.trim()
    }
  }
  
  const commaLowerPattern = /,\s+[a-z]/
  if (commaLowerPattern.test(artistString)) {
    return artistString.split(',')[0].trim()
  }
  
  const parts = artistString.split(/,\s+/)
  return parts[0].trim() || artistString
}

function artworkKey(track) {
  return JSON.stringify([track.title, track.artist, track.album])
}

function normalized(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

async function fetchiTunesArtwork(track) {
  const firstArtist = getFirstArtist(track.artist)
  if (!track.title || !firstArtist) return 'lokal_music'
  try {
    const query = encodeURIComponent(`${track.title} ${firstArtist}`)
    const response = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=5`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return 'lokal_music'
    const data = await response.json()
    const title = normalized(track.title)
    const artist = normalized(firstArtist)
    const matches = (Array.isArray(data.results) ? data.results : []).filter(result =>
      normalized(result.trackName) === title && normalized(result.artistName) === artist)
    const match = matches.find(result => normalized(result.collectionName) === normalized(track.album)) || matches[0]
    return artworkUrl({ artwork_url: match?.artworkUrl100?.replace('100x100bb', '600x600bb') }) || 'lokal_music'
  } catch { return 'lokal_music' }
}

async function closeClient(client) {
  if (!client) return
  try { await client.clearActivity() } catch {}
  try { await client.destroy() } catch {}
}

async function tryConnect(clientId) {
  if (!clientId) return false
  const generation = ++connectionGeneration
  const previous = rpcClient
  rpcClient = null
  await closeClient(previous)
  if (generation !== connectionGeneration) return false
  let client
  let timeout
  try {
    const DiscordRPC = require('discord-rpc')
    client = new DiscordRPC.Client({ transport: 'ipc' })
    rpcClient = client
    client.on('disconnected', () => { if (rpcClient === client) rpcClient = null })
    client.on('error', () => {
      if (rpcClient === client) rpcClient = null
      client.destroy().catch(() => {})
    })
    await Promise.race([
      client.login({ clientId }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), 5000) }),
    ])
    if (generation !== connectionGeneration || rpcClient !== client) {
      await closeClient(client)
      return false
    }
    if (latestPlayback) {
      await publishActivity()
      requestArtwork(latestPlayback.track)
    }
    return true
  } catch {
    if (rpcClient === client) rpcClient = null
    try { await client?.destroy() } catch {}
    return false
  } finally { clearTimeout(timeout) }
}

async function disconnectRpc() {
  connectionGeneration++
  const client = rpcClient
  rpcClient = null
  await closeClient(client)
}

async function publishActivity() {
  const client = rpcClient
  const playback = latestPlayback
  if (!client?.user || !playback) return
  try {
    if (!playback.track) {
      await client.clearActivity()
      return
    }
    const activity = buildActivity(playback.track, playback.isPlaying, {
      receivedAt: playback.at,
      artwork: artworkCache.get(artworkKey(playback.track)) || 'lokal_music',
    })
    // The installed discord-rpc helper omits type/status_display_type. Send
    // the documented activity fields directly to get Discord's listening card.
    await client.request('SET_ACTIVITY', { pid: process.pid, activity })
  } catch (error) {
    console.error('Discord RPC Error:', error)
  }
}

async function setActivity(track, isPlaying) {
  latestPlayback = { track, isPlaying: !!isPlaying, at: Date.now() }
  if (!rpcClient?.user) return
  await publishActivity()
  requestArtwork(track)
}

function requestArtwork(track) {
  if (!track || artworkUrl(track)) return
  const key = artworkKey(track)
  if (artworkCache.has(key) || artworkPending.has(key)) return
  const lookup = fetchiTunesArtwork(track).then(async artwork => {
    if (artworkCache.size >= 200) artworkCache.delete(artworkCache.keys().next().value)
    artworkCache.set(key, artwork)
    // Publish current playback, never the track/pause state captured before
    // the lookup. A slow result cannot restore a skipped or cleared song.
    if (latestPlayback?.track && artworkKey(latestPlayback.track) === key) await publishActivity()
  }).finally(() => artworkPending.delete(key))
  artworkPending.set(key, lookup)
}

function registerDiscordHandlers(ipcMain) {
  const { getDB } = require('./db')

  ipcMain.handle('discord:connect', async (_, clientId) => {
    const id = clientId || (() => {
      try {
        return getDB().prepare("SELECT value FROM settings WHERE key = 'discord_client_id'").get()?.value
      } catch {
        return null
      }
    })()
    return tryConnect(id || DEFAULT_DISCORD_CLIENT_ID)
  })

  ipcMain.handle('discord:setActivity', async (_, track, isPlaying) => {
    return setActivity(track, isPlaying)
  })

  // Connected once Discord accepted the login (the client knows its user).
  ipcMain.handle('discord:status', () => ({ connected: !!rpcClient?.user }))

  ipcMain.handle('discord:disconnect', async () => {
    await disconnectRpc()
    return true
  })
}

async function cleanupAndExit(code = 0) {
  try {
    if (rpcClient) {
      try { await rpcClient.clearActivity() } catch {}
      try { rpcClient.destroy() } catch {}
      rpcClient = null
    }
  } catch {}
  process.exit(code)
}

process.on('SIGINT', () => cleanupAndExit(0))
process.on('SIGTERM', () => cleanupAndExit(0))

process.on('uncaughtException', async (err) => {
  try { console.error(err) } catch {}
  await cleanupAndExit(1)
})

process.on('unhandledRejection', async (err) => {
  try { console.error(err) } catch {}
  await cleanupAndExit(1)
})

/**
 * On quitting: clear the status and disconnect, waiting at most `timeoutMs`
 * (Discord otherwise kept showing the last song for a while). Resolves
 * whether or not Discord answered.
 */
function disconnectForQuit(timeoutMs = 1000) {
  if (!rpcClient) return Promise.resolve()
  return Promise.race([disconnectRpc().catch(() => {}), new Promise(resolve => setTimeout(resolve, timeoutMs))])
}

module.exports = { registerDiscordHandlers, disconnectForQuit }
