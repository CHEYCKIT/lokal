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

  const fileLyrics = require('../lyrics/fileLyrics')
  const trackFilePath = trackId => {
    const row = db.prepare("SELECT file_path FROM tracks WHERE id = ?").get(trackId)
    if (!row?.file_path || String(row.file_path).startsWith('ghost://')) throw new Error('This song has no local audio file')
    return row.file_path
  }
  ipcMain.handle('lyrics:readFile', async (_, trackId) => fileLyrics.readFileLyrics(trackFilePath(trackId)))
  ipcMain.handle('lyrics:writeFile', (_, trackId, text) => {
    const result = fileLyrics.writeFileLyrics(trackFilePath(trackId), text)
    try { db.prepare('UPDATE tracks SET lyrics_kind = ? WHERE id = ?').run(fileLyrics.lyricsKind(text), trackId) } catch {}
    return result
  })
  ipcMain.handle('lyrics:embedFrom', async (_, providerId, trackId, title, artist, album, duration) => {
    const result = await service.getLyricsFrom(db, { trackId, title, artist, album, duration }, providerId)
    if (!result || (!result.lines?.length && !result.instrumental)) throw new Error('That lyrics source has no lyrics to insert')
    const { text, privateTag } = fileLyrics.fromResult(result)
    const written = fileLyrics.writeFileLyrics(trackFilePath(trackId), text, privateTag)
    try { db.prepare('UPDATE tracks SET lyrics_kind = ? WHERE id = ?').run(fileLyrics.lyricsKind(text), trackId) } catch {}
    return { ...written, source: providerId }
  })

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

  // Settings -> Library -> Maintenance: fetch and cache every library song's
  // lyrics now, so they open at once later. One song at a time; cancellable.
  let indexJob = null
  ipcMain.handle('lyrics:indexAll', async (event) => {
    if (indexJob) return { running: true }
    const job = { cancelled: false }
    indexJob = job
    const send = (payload) => { try { if (!event.sender.isDestroyed()) event.sender.send('lyrics:indexProgress', payload) } catch {} }
    try {
      const rows = db.prepare("SELECT id, title, artist, album, duration FROM tracks WHERE title IS NOT NULL AND file_path NOT LIKE 'ghost://%' ORDER BY artist, title").all()
      let done = 0
      let found = 0
      for (const row of rows) {
        if (job.cancelled) break
        send({ running: true, done, total: rows.length, found, title: `${row.artist || ''} — ${row.title}` })
        const lyrics = await service.getLyrics(db, { trackId: row.id, title: row.title, artist: row.artist, album: row.album, duration: row.duration }).catch(() => null)
        if (lyrics) found++
        done++
      }
      send({ running: false, done, total: rows.length, found, cancelled: job.cancelled })
      return { done, total: rows.length, found, cancelled: job.cancelled }
    } finally { indexJob = null }
  })
  ipcMain.handle('lyrics:cancelIndex', () => { if (indexJob) indexJob.cancelled = true })
}

module.exports = { registerLyricsHandlers }
