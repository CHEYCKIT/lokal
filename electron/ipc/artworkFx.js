// Now-playing visuals: the colour mesh behind the Details sidebar and the
// fullscreen player, and moving covers (see electron/artwork/*). Everything is
// looked up by track id, from the library -- the renderer never hands us paths.

const path = require('path')
const fs = require('fs')
const { getDB, getStorageDir } = require('./db')
const { meshFromImage } = require('../artwork/mesh')
const { motionCoverFor } = require('../artwork/motion')

function trackRow(trackId) {
  try { return getDB().prepare('SELECT id, title, artist, album, artwork_path, artwork_url FROM tracks WHERE id = ?').get(trackId) || null } catch { return null }
}

function settingsMap() {
  try { return Object.fromEntries(getDB().prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value])) } catch { return {} }
}

async function meshForTrack(trackId) {
  const track = trackRow(trackId)
  const art = track?.artwork_path
  if (art && fs.existsSync(art)) {
    let stamp = ''
    try { stamp = String(fs.statSync(art).mtimeMs) } catch {}
    return meshFromImage(art, `${art}|${stamp}`)
  }
  let url
  try {
    url = new URL(String(track?.artwork_url || ''))
    if (url.protocol !== 'https:' || !/(?:^|\.)(?:ytimg\.com|ggpht\.com|googleusercontent\.com|sndcdn\.com)$/i.test(url.hostname)) return null
  } catch { return null }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    return meshFromImage(buffer, `remote|${url.toString()}`)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function motionCacheDir() {
  return path.join(getStorageDir(), 'motion-covers')
}

async function motionForTrack(trackId, ffmpeg) {
  const track = trackRow(trackId)
  if (!track) return null
  return motionCoverFor(getDB(), track, { settings: settingsMap(), cacheDir: motionCacheDir(), ffmpeg })
}

/** Settings' Spotify "Save & Test", with the cookie as saved. */
function spotifyCheck() {
  const { checkSpotify } = require('../artwork/spotify')
  return checkSpotify(settingsMap().spotify_sp_dc)
}

function registerArtworkFxHandlers(ipcMain) {
  const { findFfmpeg } = require('./tools')
  ipcMain.handle('artwork:mesh', (_, trackId) => meshForTrack(trackId).catch(() => null))
  ipcMain.handle('artwork:motion', (_, trackId) => motionForTrack(trackId, findFfmpeg()).catch(() => null))
  ipcMain.handle('artwork:spotifyCheck', () => spotifyCheck())
}

module.exports = { registerArtworkFxHandlers, meshForTrack, motionForTrack, motionCacheDir, spotifyCheck }
