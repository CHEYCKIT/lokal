const path = require('path')

function loadNativePlayback() {
  try {
    return require(path.join(__dirname, '../native', `audio-playback.${process.platform}-${process.arch}.node`))
  } catch (error) {
    return { error }
  }
}

class NativePlayback {
  constructor(load = loadNativePlayback) {
    this.addon = null
    this.load = load
    this.timer = null
    this.getWindow = () => null
    this.endedTrack = null
  }

  instance() {
    if (!this.addon) {
      const loaded = this.load()
      if (!loaded?.AudioEngine) throw loaded?.error || new Error('Rust audio playback is unavailable in this build.')
      this.addon = new loaded.AudioEngine()
    }
    return this.addon
  }

  available() {
    try { this.instance(); return { available: true } } catch (error) {
      return { available: false, error: error.message }
    }
  }

  emit(status) {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send('native-playback:status', status)
  }

  startPolling() {
    if (this.timer) return
    this.timer = setInterval(() => {
      let status
      try { status = this.instance().status() } catch (error) {
        this.emit({ error: error.message })
        return
      }
      this.emit(status)
      if (status.ended && status.track_id && status.track_id !== this.endedTrack) {
        this.endedTrack = status.track_id
        this.emit({ event: 'ended', track_id: status.track_id })
      }
      if (!status.ended) this.endedTrack = null
    }, 100)
    this.timer.unref?.()
  }

  stopPolling() {
    clearInterval(this.timer)
    this.timer = null
  }

  async loadSource(source) {
    const { trackId, kind, value, headers, standby = false } = source || {}
    if (!trackId || !['file', 'url'].includes(kind) || typeof value !== 'string' || value.length > 32768) {
      throw new Error('Invalid native audio source.')
    }
    this.endedTrack = null
    this.startPolling()
    return this.instance().load(trackId, kind, value, headers || null, !!standby)
  }

  call(method, ...args) {
    return this.instance()[method](...args)
  }

  close() {
    this.stopPolling()
    try { this.addon?.close() } catch {}
    this.addon = null
  }
}

const playback = new NativePlayback()

function registerNativePlayback(ipcMain, getWindow) {
  const allowed = event => event.sender === getWindow()?.webContents && event.senderFrame === event.sender.mainFrame
  const handle = (name, fn) => ipcMain.handle(`native-playback:${name}`, (event, ...args) => {
    if (!allowed(event)) return { ok: false, error: 'Native playback is only available to the player.' }
    return fn(...args)
  })

  playback.getWindow = getWindow
  handle('available', () => playback.available())
  handle('load', source => playback.loadSource(source))
  for (const method of ['play', 'pause', 'stop', 'seek', 'set_volume', 'set_rate', 'transition', 'status']) {
    handle(method, (...args) => playback.call(method, ...args))
  }
  handle('close', () => { playback.close(); return { ok: true } })
}

module.exports = { NativePlayback, registerNativePlayback, closeNativePlayback: () => playback.close() }
