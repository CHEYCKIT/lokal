// AutoMix's analyses for the window (electron/automix): a song's, by its
// library file or its online stream, analysed once and kept.

function registerAutomixHandlers(ipcMain) {
  const fs = require('fs')
  const { getDB } = require('./db')
  const { analysisFor } = require('../automix')
  const log = message => { try { require('electron-log').info(message) } catch {} }

  ipcMain.handle('automix:analyze', async (_, track) => {
    if (!track?.id) return null
    const db = getDB()
    const sources = require('../online/sources')
    const ref = sources.streamRef(track)
    if (ref) {
      return analysisFor({
        db, key: `${ref.provider}:${ref.id}`, log,
        ffmpeg: () => require('./tools').findFfmpeg(),
        source: async () => {
          const stream = await sources.resolveStream(ref.provider, ref.id, require('./online').streamOptions())
          return stream?.file ? { file: stream.file } : stream?.url ? { url: stream.url, headers: stream.headers } : null
        },
      })
    }
    const file = String(track.file_path || '')
    if (!file || file.startsWith('ghost://')) return null
    return analysisFor({
      db, key: String(track.id), trackId: String(track.id), log,
      ffmpeg: () => require('./tools').findFfmpeg(),
      source: async () => (fs.existsSync(file) ? { file } : null),
    })
  })
}

module.exports = { registerAutomixHandlers }
