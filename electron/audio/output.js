const { randomUUID } = require('crypto')
const path = require('path')

// The native bridge accepts interleaved frames. Quantize once, after EQ/volume/crossfade;
// triangular dither avoids correlated distortion when reducing to 16 bits.
function encodePCM(samples, precision, random = Math.random) {
  const pcm = Buffer.allocUnsafe(samples.length * (precision === 'float32' ? 4 : 2))
  for (let i = 0; i < samples.length; i++) {
    const value = Number.isFinite(samples[i]) ? samples[i] : 0
    if (precision === 'float32') pcm.writeFloatLE(value, i * 4)
    else pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32768 + random() - random()))), i * 2)
  }
  return pcm
}

class NativeOutput {
  constructor(load = () => require(path.join(__dirname, '../native', `audio-output.${process.platform}-${process.arch}.node`))) {
    this.load = load
    this.audio = null
    this.session = null
    this.queued = 0
  }

  instance() {
    if (!this.audio) {
      this.audio = this.load()
    }
    return this.audio
  }

  devices() {
    try {
      return { available: true, supportsExclusive: this.instance().supportsExclusive(), devices: this.instance().getDevices().filter(d => d.outputChannels >= 2).map(d => ({
        name: d.name, isDefault: !!d.isDefaultOutput,
      })) }
    } catch {
      return { available: false, devices: [], error: 'Native audio output is unavailable in this build. Auto output remains available.' }
    }
  }

  open({ precision, sampleRate, deviceName = '', exclusive = false }) {
    this.close()
    if (typeof exclusive !== 'boolean' || !['pcm16', 'float32'].includes(precision) || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || typeof deviceName !== 'string' || deviceName.length > 1024) {
      return { ok: false, error: 'Unsupported audio output configuration.' }
    }
    try {
      const audio = this.instance()
      const devices = audio.getDevices().filter(d => d.outputChannels >= 2)
      const selected = deviceName ? devices.find(d => d.name === deviceName) : devices.find(d => d.isDefaultOutput)
      if (!selected) throw new Error('The selected stereo output is disconnected or unavailable.')
      let failure
      const canExclude = exclusive && audio.supportsExclusive()
      for (const share of canExclude ? [true, false] : [false]) {
        for (const format of precision === 'float32' ? ['float32', 'pcm16'] : ['pcm16']) {
          const session = randomUUID()
          try {
            const frameSize = audio.open(selected.id, sampleRate, format === 'float32' ? 32 : 16, share)
            if (!Number.isInteger(frameSize) || frameSize < 128 || frameSize > 8192) throw new Error('Unsupported audio buffer size.')
            if (audio.getStreamSampleRate() !== sampleRate) throw new Error('This device cannot accept the current playback sample rate.')
            this.session = session
            this.precision = format
            this.frameSize = frameSize
            this.queued = 0
            const actualExclusive = audio.isExclusive()
            if (share && !actualExclusive) throw new Error('The device did not accept exclusive mode.')
            const warnings = []
            if (format !== precision) warnings.push('32-bit float is unavailable on this output. Using 16-bit PCM.')
            if (exclusive && !actualExclusive) warnings.push('Exclusive mode is unavailable or the device is busy. Using shared output.')
            this.status = { exclusive: actualExclusive, ok: true, session, precision: format, sampleRate, channels: 2, frameSize,
              deviceName: selected.name, backend: audio.getApi(),
              ...(warnings.length ? { warning: warnings.join(' ') } : {}),
            }
            audio.start()
            this.lastStreamTime = audio.streamTime
            this.lastProgressAt = Date.now()
            return this.status
          } catch (error) {
            failure = error
            if (audio.isStreamOpen()) audio.closeStream()
            this.session = null
          }
        }
      }
      throw failure
    } catch (error) {
      this.close()
      return { ok: false, error: error?.message || 'Could not start native audio output.' }
    }
  }

  write(session, samples) {
    if (!this.session || session !== this.session) return { ok: false, stale: true }
    if (!(samples instanceof Float32Array) || samples.length !== this.frameSize * 2) return { ok: false, error: 'Invalid PCM frame.' }
    try {
      if (!this.audio.isStreamRunning()) throw new Error('Audio output stopped.')
      const time = this.audio.streamTime
      if (time > this.lastStreamTime) this.lastProgressAt = Date.now()
      if (Date.now() - this.lastProgressAt > 2000) throw new Error('Audio output is no longer responding.')
      this.queued = Math.max(0, this.queued - Math.max(0, time - this.lastStreamTime) * this.status.sampleRate / this.frameSize)
      this.lastStreamTime = time
      // Bound latency and memory if the renderer and hardware clocks drift or
      // the main thread stalls. Never replay a long queue of stale audio.
      if (this.queued >= 6) { this.audio.clearOutputQueue(); this.queued = 0 }
      this.audio.write(encodePCM(samples, this.precision))
      this.queued++
      return { ok: true }
    } catch (error) {
      this.close()
      return { ok: false, error: error.message }
    }
  }

  flush(session) {
    if (session !== this.session) return
    this.audio?.clearOutputQueue()
    this.queued = 0
    this.lastStreamTime = this.audio.streamTime
  }

  close() {
    this.session = null
    this.queued = 0
    this.status = null
    if (this.audio?.isStreamOpen()) {
      try { this.audio.closeStream() } catch {}
      try { this.audio.clearOutputQueue() } catch {}
    }
  }
}

const output = new NativeOutput()
function registerNativeOutput(ipcMain, getWindow) {
  const allowed = event => event.sender === getWindow()?.webContents && event.senderFrame === event.sender.mainFrame
  const handle = (channel, fn) => ipcMain.handle(`audio-output:${channel}`, (event, ...args) => {
    if (!allowed(event)) return { ok: false, error: 'Audio output is only available to the player.' }
    return fn(...args)
  })
  handle('devices', () => output.devices())
  handle('open', options => output.open(options || {}))
  handle('write', (session, samples) => output.write(session, samples))
  handle('flush', session => { output.flush(session); return { ok: true } })
  handle('close', () => { output.close(); return { ok: true } })
}
module.exports = { NativeOutput, encodePCM, registerNativeOutput, closeNativeOutput: () => output.close() }
