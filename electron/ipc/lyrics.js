// Lyrics IPC -- thin wrappers over electron/lyrics/service.js, which the web
// server's routes share, so desktop and web behave identically.

const { getDB } = require('./db')
const service = require('../lyrics/service')

function registerLyricsHandlers(ipcMain) {
  const db = getDB()

  // filePath arguments are accepted for compatibility but ignored: the
  // service resolves the file from the library by track id.
  ipcMain.handle('lyrics:get', (_, trackId, title, artist, album, duration, _filePath, options = {}) =>
    service.getLyrics(db, { trackId, title, artist, album, duration, refresh: !!options?.refresh }))

  ipcMain.handle('lyrics:getFrom', (_, providerId, trackId, title, artist, album, duration) =>
    service.getLyricsFrom(db, { trackId, title, artist, album, duration }, providerId))

  ipcMain.handle('lyrics:sources', () => service.sources(db))

  ipcMain.handle('lyrics:import', (_, trackId, content, type) =>
    service.importLyrics(db, trackId, content, type))

  ipcMain.handle('lyrics:clearCache', (_, trackId) => service.clearCache(db, trackId))

  ipcMain.handle('lyrics:translate', (_, trackId, lines, targetLang) =>
    service.translate(db, trackId, lines, targetLang))

  ipcMain.handle('lyrics:romanize', (_, trackId, lines) =>
    service.romanize(db, trackId, lines))

  // Kept for older callers; translation now reports the detected language itself.
  ipcMain.handle('lyrics:detectLanguage', async (_, trackId, lines) => {
    const r = await service.translate(db, trackId, lines, 'en')
    const lang = r?.detectedLang || 'unknown'
    return { lang, confidence: lang === 'unknown' ? 0 : 0.9, source: 'remote' }
  })
}

module.exports = { registerLyricsHandlers }
