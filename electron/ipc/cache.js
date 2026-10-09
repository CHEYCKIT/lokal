// Settings → Data → Cache: what Lokal's caches use, their limit, and clearing
// them. Lokal's own files are in electron/cache.js; Chromium's web cache
// (covers and pages it fetched) is the app session's.

const { session } = require('electron')
const cache = require('../cache')

async function report() {
  const used = cache.usage()
  let web = 0
  try { web = await session.defaultSession.getCacheSize() } catch {}
  return { motion: used.motion, playback: used.playback, musicVideo: used.musicVideo, web, limit: cache.limitBytes(), limits: cache.LIMITS_MB }
}

function registerCacheHandlers(ipcMain) {
  ipcMain.handle('cache:usage', () => report())
  // After the limit is changed: bring the caches under it now.
  ipcMain.handle('cache:trim', () => { cache.trim(); return report() })
  ipcMain.handle('cache:clear', async () => {
    cache.clear()
    try { await session.defaultSession.clearCache() } catch {}
    return report()
  })
}

module.exports = { registerCacheHandlers }
