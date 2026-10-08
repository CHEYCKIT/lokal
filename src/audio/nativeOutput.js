export const normalizePrecision = value => ['auto', 'pcm16', 'float32'].includes(value) ? value : 'auto'
export function readOutputPreferences() {
  try {
    const data = JSON.parse(localStorage.getItem('lokal-output-precision') || '{}')
    return { precision: normalizePrecision(data?.precision), deviceName: typeof data?.deviceName === 'string' ? data.deviceName : '', exclusive: data?.exclusive === true }
  } catch { return { precision: 'auto', deviceName: '', exclusive: false } }
}
export function saveOutputPreferences(value) {
  try { localStorage.setItem('lokal-output-precision', JSON.stringify(value)) } catch {}
}

export class NativeAudioBridge {
  constructor(context, source, api, publish = () => {}) {
    this.context = context
    this.source = source
    this.api = api
    this.publish = publish
    this.epoch = 0
    this.session = null
    this.chain = Promise.resolve()
    this.status = { mode: 'auto', sampleRate: context.sampleRate }
    this.exclusive = false
    this.playing = false
    this.preferences = { precision: 'auto' }
  }
  report(status) {
    this.status = status
    this.publish(status)
  }
  configure(preferences) {
    this.preferences = { ...preferences }
    // Serialize opening/closing the device; rapid UI changes cannot leave two
    // live outputs or let an old result replace a newer route.
    this.requestedExclusive = preferences.precision !== 'auto' && preferences.exclusive === true
    return this.schedule()
  }
  setPlaying(playing) {
    if (this.playing === playing) return this.chain
    this.playing = playing
    return this.schedule()
  }
  schedule() {
    const revision = this.revision = (this.revision || 0) + 1
    this.chain = this.chain.catch(() => {}).then(async () => {
      if (revision !== this.revision) return this.status
      this.transitioning = true
      try { return await this.apply(this.preferences) }
      finally { this.transitioning = false }
    })
    return this.chain
  }
  async apply({ precision, deviceName = '', exclusive = false }) {
    await this.fallback(undefined, precision === 'auto' && this.playing)
    if (!this.playing || precision === 'auto') return this.status
    try {
      if (!this.node) {
        await this.context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url))
        this.node = new AudioWorkletNode(this.context, 'lokal-pcm-output', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
        })
        this.node.port.onmessage = event => this.send(event.data)
        if (this.api.directTransport) {
          const { port1, port2 } = new MessageChannel()
          window.postMessage({ type: 'lokal:audio-output-port' }, '*', [port1])
          this.node.port.postMessage({ type: 'transport', port: port2 }, [port2])
        }
      }
      if (typeof this.context.setSinkId === 'function') {
        // fallback() leaves Chromium on its silent sink for native output.
        // Do not capture that sink as the speaker to restore later.
        await this.silenceBrowserOutput()
      } else if (exclusive) throw new Error('This build cannot release browser output for exclusive mode.')
      if (!this.playing) { await this.fallback(); return this.status }
      const result = await this.api.open({ precision, deviceName, exclusive, sampleRate: this.context.sampleRate })
      if (!result?.ok) throw new Error(result?.error || 'Native output could not be started.')
      if (!this.playing) { await this.fallback(); return this.status }
      this.session = result.session
      this.frameSize = result.frameSize
      this.source.disconnect(this.context.destination)
      this.source.connect(this.node)
      this.node.connect(this.context.destination)
      this.exclusive = result.exclusive === true
      this.resetWorklet(true)
      await this.context.resume()
      this.report({ ...result, mode: 'native' })
    } catch (error) { await this.fallback(`${error.message} Using Auto output.`) }
    return this.status
  }
  resetWorklet(active) {
    this.epoch++
    // Keep the transport window below the native PCM ring in each mode.
    const credits = this.exclusive && active ? 64 : 24
    const pendingBlocks = this.exclusive && active ? 48 : 8
    this.node?.port.postMessage({ type: 'configure', active, session: this.session, epoch: this.epoch, frameSize: this.frameSize || 1024, credits, pendingBlocks })
  }
  async send({ epoch, samples, error }) {
    if (!this.session || epoch !== this.epoch) return
    const session = this.session
    try {
      if (error) throw new Error(error)
      const result = await this.api.write(session, samples)
      if (session !== this.session || epoch !== this.epoch) return
      if (!result?.ok) throw new Error(result?.error || 'Native output stopped.')
      this.node.port.postMessage({ type: 'credit', epoch })
    } catch (error) {
      // The same serialized route handles device removal and write failures.
      if (session === this.session) {
        this.session = null
        this.chain = this.chain.catch(() => {}).then(async () => {
          this.transitioning = true
          try { return await this.fallback(`${error.message} Using Auto output.`) }
          finally { this.transitioning = false }
        })
      }
    }
  }
  flush() {
    if (!this.session) return
    this.resetWorklet(true)
    // The direct port orders the reset with PCM blocks across seeks.
    if (!this.api.directTransport) this.api.flush(this.session).catch(() => {})
  }
  async fallback(warning, resume = this.playing) {
    this.session = null
    this.exclusive = false
    this.resetWorklet(false)
    // Suspending releases Chromium's shared device too, including Auto while
    // idle. Never restore an audible sink while the exclusive stream is open.
    await this.context.suspend()
    // Silence the native route before reconnecting Chromium to avoid doubled audio.
    try { await this.api.close() } catch {}
    if (this.node) {
      try { this.source.disconnect(this.node) } catch {}
      this.node.disconnect()
    }
    this.source.connect(this.context.destination)
    if (resume && this.playing) {
      try { await this.restoreBrowserOutput() }
      catch (error) { warning = error.message }
      await this.context.resume()
    } else if (!this.playing && this.silentSink) {
      try { await this.restoreBrowserOutput() }
      catch (error) { warning = error.message }
    }
    this.report({ mode: !this.playing ? 'idle' : resume ? 'auto' : 'switching', sampleRate: this.context.sampleRate, ...(warning ? { warning } : {}) })
  }
  async silenceBrowserOutput() {
    if (typeof this.context.setSinkId !== 'function') return
    if (this.silentSink) return
    this.previousSink = this.browserDeviceId ?? this.context.sinkId ?? ''
    await this.context.setSinkId({ type: 'none' })
    this.silentSink = true
  }
  async restoreBrowserOutput() {
    if (!this.silentSink && !this.browserDeviceId) return
    try { await this.context.setSinkId(this.browserDeviceId ?? this.previousSink ?? '') }
    catch {
      try { await this.context.setSinkId('') }
      catch { throw new Error('Could not restore browser audio output. Select an available output device.') }
    }
    this.silentSink = false
    this.previousSink = null
  }
}
