// Downloader IPC. The queue itself lives in electron/download/manager.js, shared
// with the web server (which runs in this same process), so a download started
// from a remote browser shows up here too, and vice versa.

const { spawn } = require('child_process')
const fs = require('fs-extra')
const { getDB, getStorageDir } = require('./db')
const { findYtDlp, findFfmpeg, findFfprobe } = require('./tools')
const { getDownloadManager } = require('../download/manager')
const { runJsonSearch, mapSearchResult, mapArtistResult } = require('../download/search')

const searchProcesses = new Set()

function trackProcess(proc) {
  if (!proc) return proc
  searchProcesses.add(proc)
  const cleanup = () => searchProcesses.delete(proc)
  proc.once('close', cleanup)
  proc.once('error', cleanup)
  return proc
}

function terminateProcessTree(proc) {
  if (!proc) return Promise.resolve()
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    let settled = false
    const finish = () => { if (!settled) { settled = true; clearTimeout(timeout); resolve() } }
    const timeout = setTimeout(finish, 8000)
    proc.once('close', finish)
    proc.once('exit', finish)
    proc.once('error', finish)
    try { proc.kill('SIGTERM') } catch {}
    if (process.platform === 'win32' && proc.pid) {
      try {
        const killer = spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true })
        killer.once('close', () => {})
        killer.once('error', () => {})
      } catch {}
    } else {
      try { proc.kill('SIGKILL') } catch {}
    }
  })
}

function getVideoIdsFromArchive(archivePath) {
  const ids = new Set()
  try {
    if (!fs.existsSync(archivePath)) return ids
    for (const line of fs.readFileSync(archivePath, 'utf-8').split(/\r?\n/)) {
      const match = line.match(/([a-zA-Z0-9_-]{11})/)
      if (match) ids.add(match[1])
    }
  } catch {}
  return ids
}

function markPlaylistIncomplete(playlistId, downloadedCount = 0, totalTracks = 0) {
  try {
    getDB().prepare('UPDATE downloaded_playlists SET status = ?, downloaded_count = ?, total_tracks = ?, last_downloaded_at = ? WHERE id = ?')
      .run('incomplete', downloadedCount, totalTracks, Date.now(), playlistId)
  } catch {}
}

function markInterruptedPlaylistsIncomplete() {
  try {
    getDB().prepare('UPDATE downloaded_playlists SET status = ?, last_downloaded_at = ? WHERE status = ?')
      .run('incomplete', Date.now(), 'downloading')
  } catch {}
}

function broadcast(channel, payload) {
  const { BrowserWindow } = require('electron')
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** The desktop side of the shared queue: its tools, its library, its windows. */
function manager() {
  return getDownloadManager().configure({
    getDB,
    getStorageDir,
    findTools: () => ({ ytdlp: findYtDlp(), ffmpeg: findFfmpeg(), ffprobe: findFfprobe() }),
    requireFfmpeg: true,
    index: async (filepath, opts) => {
      const { indexSingleFile } = require('./scanner')
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          if (fs.existsSync(filepath)) {
            const result = await indexSingleFile(filepath, opts)
            if (result?.id) return result
          }
        } catch {}
        await new Promise(r => setTimeout(r, 700))
      }
      return null
    },
    onLibraryUpdated: (result) => broadcast('library:updated', result),
    emit: (snapshot) => broadcast('downloader:progress', snapshot),
  }, 10)
}

const YTDLP_MISSING = 'yt-dlp not found. Go to Settings -> External Tools to download it automatically or set a custom path.'

function registerDownloaderHandlers(ipcMain) {
  manager().init()

  ipcMain.handle('downloader:search', async (_, query, page = 1) => {
    const ytdlp = findYtDlp()
    if (!ytdlp) return { error: YTDLP_MISSING, results: [], page: 1, hasMore: false }
    return runJsonSearch(ytdlp, query, mapSearchResult, page, 10, trackProcess)
  })

  ipcMain.handle('downloader:searchArtist', async (_, query, page = 1) => {
    const ytdlp = findYtDlp()
    if (!ytdlp) return { error: YTDLP_MISSING, results: [], page: 1, hasMore: false }
    const primary = await runJsonSearch(ytdlp, `${query} official artist channel`, mapArtistResult, page, 10, trackProcess)
    if (primary.results.length > 0 || primary.error) return primary
    return runJsonSearch(ytdlp, `${query} artist profile`, mapArtistResult, page, 10, trackProcess)
  })

  ipcMain.handle('downloader:download', (_, url, opts = {}) => manager().enqueue('single', url, opts || {}))
  ipcMain.handle('downloader:cancel', (_, id) => manager().cancel(id))
  ipcMain.handle('downloader:remove', (_, id) => manager().remove(id))
  ipcMain.handle('downloader:retry', (_, id) => manager().retry(id))
  ipcMain.handle('downloader:cancelAll', () => manager().cancelAll())
  ipcMain.handle('downloader:clearFinished', () => manager().clearFinished())
  ipcMain.handle('downloader:markSeen', () => manager().markSeen())
  ipcMain.handle('downloader:queue', () => manager().list())
}

function registerExtraDownloaderHandlers(ipcMain) {
  ipcMain.handle('downloader:downloadPlaylist', (_, url, opts = {}) => manager().enqueue('playlist', url, opts || {}))
}

function registerPlaylistArchiveHandlers(ipcMain) {
  ipcMain.handle('downloader:getDownloadedPlaylists', () => {
    return getDB().prepare('SELECT * FROM downloaded_playlists ORDER BY COALESCE(last_downloaded_at, created_at) DESC').all()
  })

  ipcMain.handle('downloader:deleteDownloadedPlaylist', (_, playlistId) => {
    const db = getDB()
    const playlist = db.prepare('SELECT * FROM downloaded_playlists WHERE id = ?').get(playlistId)
    if (playlist?.archive_path) {
      try { fs.unlinkSync(playlist.archive_path) } catch {}
    }
    db.prepare('DELETE FROM downloaded_playlists WHERE id = ?').run(playlistId)
    return { success: true }
  })

  ipcMain.handle('downloader:redownloadPlaylist', async (_, playlistId) => {
    const db = getDB()
    const playlist = db.prepare('SELECT * FROM downloaded_playlists WHERE id = ?').get(playlistId)
    if (!playlist) return { error: 'Playlist not found' }
    const running = manager().hasPlaylistRunning(playlistId, playlist.url)
    if (running) await manager().remove(running.id)
    if (playlist.archive_path && fs.existsSync(playlist.archive_path)) {
      try { fs.unlinkSync(playlist.archive_path) } catch {}
    }
    db.prepare('DELETE FROM downloaded_playlists WHERE id = ?').run(playlistId)
    return manager().enqueue('playlist', playlist.url, { playlistId, title: playlist.title, from: 'Re-download' })
  })

  ipcMain.handle('downloader:getPlaylistArchiveIds', (_, playlistId) => {
    const playlist = getDB().prepare('SELECT archive_path FROM downloaded_playlists WHERE id = ?').get(playlistId)
    if (!playlist?.archive_path) return []
    return Array.from(getVideoIdsFromArchive(playlist.archive_path))
  })

  ipcMain.handle('downloader:removeFromPlaylistArchive', (_, playlistId, videoId) => {
    const playlist = getDB().prepare('SELECT archive_path FROM downloaded_playlists WHERE id = ?').get(playlistId)
    if (!playlist?.archive_path) return { error: 'Playlist not found' }
    try {
      if (fs.existsSync(playlist.archive_path)) {
        const next = fs.readFileSync(playlist.archive_path, 'utf-8')
          .split(/\r?\n/)
          .filter(line => line && !line.includes(videoId))
          .join('\n')
        fs.writeFileSync(playlist.archive_path, next)
      }
      return { success: true }
    } catch (error) {
      return { error: error.message }
    }
  })
}

module.exports = {
  registerDownloaderHandlers,
  registerExtraDownloaderHandlers,
  registerPlaylistArchiveHandlers,
  terminateProcessTree,
  markInterruptedPlaylistsIncomplete,
  markPlaylistIncomplete,
  // yt-dlp is about to be replaced: running downloads stop and wait in line.
  stopActiveDownloadsForToolUpdate: async () => {
    const downloads = await manager().suspend()
    await Promise.all([...searchProcesses].map(proc => terminateProcessTree(proc)))
    return { success: true, count: downloads.count, ids: downloads.ids }
  },
  resumeDownloadsAfterToolUpdate: () => manager().resume(),
  shutdownActiveDownloads: () => {
    manager().shutdown()
    for (const proc of searchProcesses) terminateProcessTree(proc)
    searchProcesses.clear()
  },
}
