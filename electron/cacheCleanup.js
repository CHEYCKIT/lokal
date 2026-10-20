// Cache Analysis page's two clean-up buttons.
//   safe: what nothing needs any more or what comes back by itself -- covers no
//         track, artist or playlist uses, Chromium's web / code / shader caches,
//         Lokal's own caches (motion covers, converted copies...), sign-in
//         profiles left over from cancelled sign-ins, old logs, and the
//         database's unused pages (checkpoint + VACUUM).
//   full: all of that, plus everything kept for web services -- the YouTube
//         Music sign-in, cookies, every web profile's stored data, the exported
//         YouTube cookies and the music video cache. Sign-ins have to be done again.
// The library itself (database rows, covers in use, settings, tools) stays.

const fs = require('fs')
const path = require('path')
const cache = require('./cache')
const { artwork, measure, ghostTracks } = require('./cacheAnalysis')
const { dropTracks } = require('./libraryPrune')

const rm = async (p) => { try { await fs.promises.rm(p, { recursive: true, force: true }); return true } catch { return false } }

async function children(dir) {
  try { return await fs.promises.readdir(dir) } catch { return [] }
}

/**
 * mode: 'safe' | 'full'. electron: { session }; currentLog: the log file being
 * written now (kept). Returns { ok, freed, before, after, steps }.
 */
async function clean({ mode, userData, dataDir, db, electron, activePartition, currentLog }) {
  const full = mode === 'full'
  const steps = []
  const step = async (id, fn) => {
    try { const result = await fn(); steps.push({ id, ok: true, ...(result && typeof result === 'object' ? result : {}) }) }
    catch (e) { steps.push({ id, ok: false, error: e?.message || String(e) }) }
  }
  const before = (await measure(userData)).size
  const { session } = electron

  // Covers nothing in the library points to any more.
  if (dataDir) {
    await step('unusedArtwork', async () => {
      // Convert eligible old full-size embedded covers before collecting unused files.
      let shrunk = { converted: 0, freed: 0, skipped: 0, trackIds: [] }
      if (db) {
        shrunk = await require('./artwork/shrinkCovers').shrinkCovers(db, path.join(dataDir, 'artwork'))
        if (shrunk.trackIds?.length) {
          try {
            for (const win of require('electron').BrowserWindow.getAllWindows()) {
              if (!win.isDestroyed()) win.webContents.send('library:changed', { added: [], removed: [], updated: [...new Set(shrunk.trackIds)] })
            }
          } catch {}
        }
      }
      const info = await artwork(path.join(dataDir, 'artwork'), db)
      let removed = 0
      for (const f of info.unusedFiles || []) if (await rm(f)) removed++
      return { removed, thumbnailsCreated: shrunk.converted || 0, artworkBytesFreed: shrunk.freed || 0, artworkSkipped: shrunk.skipped || 0 }
    })
  }

  // Lokal's own caches: all of it can be made again.
  await step('lokalCache', () => {
    const removed = cache.clear()
    let videos = 0
    if (full) {
      const dir = cache.cacheDir('musicVideo')
      try { for (const f of fs.readdirSync(dir)) { try { fs.unlinkSync(path.join(dir, f)); videos++ } catch {} } } catch {}
    }
    return { removed: removed + videos }
  })

  // Chromium's caches in the app's own session and in every saved web profile.
  const partitionsDir = path.join(userData, 'Partitions')
  const partitions = await children(partitionsDir)
  const sessions = [session.defaultSession, ...partitions.map(name => session.fromPartition(`persist:${name}`))]
  await step('webCache', async () => {
    for (const s of sessions) {
      try { await s.clearCache() } catch {}
      try { await s.clearCodeCaches({}) } catch {}
      try { await s.clearStorageData({ storages: ['shadercache', 'cachestorage'] }) } catch {}
    }
  })

  // Sign-in profiles: left over from sign-ins that never finished (safe), or all of them (full).
  const active = String(activePartition || '').replace(/^persist:/, '')
  await step(full ? 'webSessions' : 'leftoverSessions', async () => {
    let removed = 0
    for (const name of partitions) {
      const leftover = /^lokal-ytmusic-[\da-f-]+$/i.test(name) && name !== active
      if (!full && !leftover) continue
      try { await session.fromPartition(`persist:${name}`).clearStorageData() } catch {}
      if (leftover || full) { if (await rm(path.join(partitionsDir, name))) removed++ }
    }
    return { removed }
  })

  if (full) {
    // The app's own cookies and site data. Local Storage (the app's own
    // remembered tab, folder and layout) is kept.
    await step('cookies', async () => {
      await session.defaultSession.clearStorageData({ storages: ['cookies', 'indexdb', 'serviceworkers', 'cachestorage', 'shadercache', 'websql', 'filesystem'] })
    })
    // Cookies exported for yt-dlp.
    if (dataDir) {
      await step('youtubeCookies', async () => {
        let removed = 0
        for (const name of await children(dataDir)) if (/^youtube-cookies/.test(name) && await rm(path.join(dataDir, name))) removed++
        return { removed }
      })
    }
  }

  // Logs of earlier launches (the one being written now stays).
  await step('logs', async () => {
    const dir = path.join(userData, 'logs')
    const keep = currentLog ? path.resolve(currentLog).toLowerCase() : null
    let removed = 0
    for (const name of await children(dir)) {
      const p = path.join(dir, name)
      if (name === 'main.log' || path.resolve(p).toLowerCase() === keep) continue
      if (await rm(p)) removed++
    }
    return { removed }
  })

  // Online songs kept as ghost tracks: the ones nothing refers to (safe), and
  // the ones with only play history, with that history (full). Ones in a
  // playlist or liked stay. Before the VACUUM below, so their space is freed.
  if (db) {
    await step('ghostTracks', () => {
      const ghosts = ghostTracks(db)
      const ids = full ? [...ghosts.unused.ids, ...ghosts.history.ids] : ghosts.unused.ids
      return { removed: dropTracks(db, ids.map(id => ({ id })), () => null).removed }
    })
  }

  // The database: fold the write-ahead log back in and drop unused pages.
  if (db) {
    await step('database', () => {
      try { db.pragma('wal_checkpoint(TRUNCATE)') } catch {}
      db.exec('VACUUM')
      try { db.pragma('wal_checkpoint(TRUNCATE)') } catch {}
    })
  }

  const after = (await measure(userData)).size
  return { ok: true, mode, before, after, freed: Math.max(0, before - after), steps }
}

module.exports = { clean }
