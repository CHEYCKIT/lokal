// IPC for the Audio Quality page and "Get it in lossless" (see electron/quality).

const { getDB } = require('./db')
const quality = require('../quality')
const { buyLinks } = require('../quality/stores')

const wrap = (fn) => async (...args) => {
  try { return await fn(...args) } catch (e) { return { error: e.message } }
}

function registerQualityHandlers(ipcMain) {
  ipcMain.handle('quality:summary', wrap(() => quality.summary(getDB())))
  ipcMain.handle('quality:list', wrap((_, opts) => quality.list(getDB(), opts || {})))
  ipcMain.handle('quality:status', wrap(() => quality.status()))
  ipcMain.handle('quality:read', wrap((_, opts) => quality.startReading(getDB(), opts || {})))
  ipcMain.handle('quality:check', wrap((_, opts) => quality.startChecking(getDB(), opts || {})))
  ipcMain.handle('quality:checkOne', wrap((_, trackId) => quality.checkOne(getDB(), trackId)))
  ipcMain.handle('quality:cancel', wrap(() => quality.cancel()))
  ipcMain.handle('quality:buyLinks', wrap((_, trackId) => {
    const track = getDB().prepare('SELECT id, title, artist, album, duration, isrc FROM tracks WHERE id = ?').get(String(trackId || ''))
    return track ? buyLinks(track) : { error: 'Track not found' }
  }))
}

module.exports = { registerQualityHandlers }
