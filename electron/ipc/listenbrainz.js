// Desktop side of the ListenBrainz integration (see ../listenbrainz.js).
const { getDB } = require('./db')
const lb = require('../listenbrainz')

function registerListenBrainzHandlers(ipcMain) {
  ipcMain.handle('listenbrainz:status', () => lb.status(getDB()))
  ipcMain.handle('listenbrainz:connect', (_, token) => lb.connect(getDB(), token))
  ipcMain.handle('listenbrainz:disconnect', () => lb.disconnect(getDB()))
  ipcMain.handle('listenbrainz:setEnabled', (_, enabled) => {
    getDB().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('listenbrainz_enabled', ?)").run(enabled ? '1' : '0')
    return lb.status(getDB())
  })
  ipcMain.handle('listenbrainz:nowPlaying', (_, track) => lb.nowPlaying(getDB(), track).catch(e => ({ error: e.message })))
  ipcMain.handle('listenbrainz:submit', (_, track, listenedAt) => lb.submitListen(getDB(), track, listenedAt).catch(e => ({ error: e.message })))
  // Listens queued while offline: try once shortly after start-up.
  setTimeout(() => {
    try {
      const s = lb.settingsOf(getDB())
      if (s.enabled && s.token) lb.flushQueue(getDB(), s.token).catch(() => {})
    } catch {}
  }, 15000)
}

module.exports = { registerListenBrainzHandlers }
