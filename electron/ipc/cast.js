// Casting, for the window: the devices on the network, the session, and the
// window of songs the TV should hold (see electron/cast/controller.js for how
// the TV is kept in step, src/cast/useCastPlayback.js for the player's side).
//
// Settings → Playback → Casting:
//   cast_quality   "max" (FLAC up to 24-bit / 96 kHz) or "standard" (16 / 48)
//   cast_devices   devices added by their address (JSON)

const { CastDiscovery, probeAddress } = require('../cast/discovery')
const { CastController } = require('../cast/controller')
const { createCastMediaServer } = require('../cast/mediaServer')
const { createCastMedia } = require('../cast/media')
const { LOKAL_CAST_APP_ID } = require('../cast/appId')

let discovery = null
let controller = null
let server = null
let blocker = null

function settings(getDB) {
  try { return Object.fromEntries(getDB().prepare('SELECT key, value FROM settings').all().map(row => [row.key, row.value])) } catch { return {} }
}

function saveSetting(getDB, key, value) {
  try { getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value)) } catch {}
}

/** The receiver app to start: Lokal's registered one, else none (Google's). */
function appIdFrom() {
  return LOKAL_CAST_APP_ID || null
}

function registerCastHandlers(ipcMain, { getWindow, powerSaveBlocker }) {
  const { getDB } = require('./db')
  const log = message => { try { require('electron-log').info(message) } catch {} }
  const send = (channel, payload) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  const ensureDiscovery = () => {
    if (discovery) return discovery
    discovery = new CastDiscovery({ log })
    try {
      for (const device of JSON.parse(settings(getDB).cast_devices || '[]')) discovery.addManual(device)
    } catch {}
    discovery.on('change', list => send('cast:devices', list))
    return discovery
  }

  const ensureController = () => {
    if (controller) return controller
    server = createCastMediaServer({ log })
    const sources = require('../online/sources')
    const online = require('./online')
    const cache = require('../cache')
    const media = createCastMedia({
      server,
      cacheDir: () => cache.cacheDir('cast'),
      ffmpeg: () => require('./tools').findFfmpeg(),
      quality: () => (settings(getDB).cast_quality === 'standard' ? 'standard' : 'max'),
      trackRow: id => { try { return getDB().prepare('SELECT * FROM tracks WHERE id = ?').get(id) || null } catch { return null } },
      streamRef: track => sources.streamRef(track),
      resolveStream: (provider, id) => sources.resolveStream(provider, id, online.streamOptions()),
      fetchStream: (provider, id, { range, signal }) => sources.fetchStream(provider, id, { ...online.streamOptions(), range, signal }),
      probe: async file => {
        const meta = await require('../musicMetadata').parseFile(file, { duration: false, skipCovers: true })
        const format = meta?.format || {}
        return { codec: format.codec || format.container || null, sampleRate: format.sampleRate || null, bitDepth: format.bitsPerSample || null, lossless: format.lossless ? 1 : 0 }
      },
      trimCache: keep => cache.trim({ keep }),
      log,
    })
    controller = new CastController({ media, server, appId: appIdFrom(), log })
    controller.on('status', status => {
      send('cast:status', status)
      // The computer stays awake while the TV plays from it.
      const playing = status.state === 'connected'
      if (playing && blocker == null) blocker = powerSaveBlocker.start('prevent-app-suspension')
      else if (!playing && blocker != null) { try { powerSaveBlocker.stop(blocker) } catch {} blocker = null }
    })
    controller.on('ended', info => send('cast:ended', info))
    controller.on('finished', () => send('cast:finished'))
    controller.on('trackError', info => send('cast:trackError', info))
    controller.on('custom', data => send('cast:custom', data))
    return controller
  }

  const guard = work => async (...args) => {
    try { return await work(...args) } catch (error) { return { error: error?.message || String(error) } }
  }

  // The list, and a few seconds of asking hard (the menu is open).
  ipcMain.handle('cast:devices', () => {
    const found = ensureDiscovery()
    found.scan(15000)
    return found.list()
  })
  ipcMain.handle('cast:addDevice', guard(async (_, address) => {
    const device = await probeAddress(address)
    ensureDiscovery().addManual(device)
    const saved = (() => { try { return JSON.parse(settings(getDB).cast_devices || '[]') } catch { return [] } })().filter(entry => entry.id !== device.id)
    saveSetting(getDB, 'cast_devices', JSON.stringify([...saved, device]))
    return device
  }))
  ipcMain.handle('cast:removeDevice', guard(async (_, id) => {
    ensureDiscovery().removeManual(id)
    const saved = (() => { try { return JSON.parse(settings(getDB).cast_devices || '[]') } catch { return [] } })().filter(entry => entry.id !== id)
    saveSetting(getDB, 'cast_devices', JSON.stringify(saved))
    return { ok: true }
  }))
  ipcMain.handle('cast:connect', guard(async (_, deviceId) => {
    const device = ensureDiscovery().get(deviceId)
    if (!device) throw new Error('That device is no longer on the network')
    const session = ensureController()
    session.appId = appIdFrom()
    const result = await session.connect(device)
    saveSetting(getDB, 'cast_last_device', device.id)
    return { ...result, status: session.status() }
  }))
  ipcMain.handle('cast:disconnect', guard(async (_, options) => (controller ? controller.disconnect(options || {}) : null)))
  ipcMain.handle('cast:status', () => (controller ? controller.status() : { state: 'idle' }))
  ipcMain.handle('cast:setWindow', guard(async (_, window) => { await ensureController().setWindow(window); return { ok: true } }))
  ipcMain.handle('cast:command', guard(async (_, command) => {
    const session = ensureController()
    if (command?.type === 'play') await session.play()
    else if (command?.type === 'pause') await session.pause()
    else if (command?.type === 'seek') await session.seek(command.position)
    else if (command?.type === 'volume') await session.setVolume({ level: command.level })
    else if (command?.type === 'mute') await session.setVolume({ muted: command.muted })
    return { ok: true }
  }))
  ipcMain.handle('cast:custom', (_, data) => (controller ? controller.sendCustom(data) : false))
  ipcMain.handle('cast:upNext', (_, tracks) => (controller ? controller.sendUpNext(tracks) : false))
  // The song's music video for Lokal's receiver (On the TV → Video), or none.
  ipcMain.handle('cast:video', guard(async (_, request) => {
    if (!controller) return { found: false }
    const trackId = request?.trackId
    if (!trackId) { controller.sendVideo(null); return { found: false } }
    const online = require('./online')
    const video = await online.prepareMusicVideoFor(trackId).catch(() => null)
    if (!video?.videoId || !/^[\w-]{11}$/.test(String(video.videoId))) { controller.sendVideo({ trackId }); return { found: false } }
    const extra = Number(request.offset) || 0
    const segments = (Array.isArray(video.segments) ? video.segments : [{ start: 0, end: null, offset: 0 }])
      .map(segment => ({ start: Number(segment.start) || 0, end: segment.end == null ? null : Number(segment.end), offset: (Number(segment.offset) || 0) + extra }))
    const fs = require('fs')
    const file = video.file && fs.existsSync(video.file) ? video.file : null
    const item = file
      ? { kind: 'file', path: file, mime: /\.webm$/i.test(file) ? 'video/webm' : 'video/mp4' }
      : { kind: 'relay', mime: null, label: `video ${video.videoId}`, fetchRange: range => online.musicVideoStream(video.videoId, range) }
    controller.sendVideo({ trackId, item, name: file ? 'video' + (/\.webm$/i.test(file) ? '.webm' : '.mp4') : 'video', segments })
    return { found: true, downloaded: !!file }
  }))
}

/** Lokal quitting: the TV is let go of (its app closed), and nothing is left listening. */
async function shutdownCast() {
  try { await controller?.disconnect({ stopReceiver: true }) } catch {}
  try { discovery?.stop() } catch {}
}

module.exports = { registerCastHandlers, shutdownCast }
