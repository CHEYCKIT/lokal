export const normalizePrecision = value => ['auto', 'pcm16', 'float32'].includes(value) ? value : 'auto'
export function readOutputPreferences() {
  try {
    const data = JSON.parse(localStorage.getItem('lokal-output-precision') || '{}')
    return { precision: normalizePrecision(data?.precision), deviceName: typeof data?.deviceName === 'string' ? data.deviceName : '' }
  } catch { return { precision: 'auto', deviceName: '' } }
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
  }
  report(status) {
    this.status = status
    this.publish(status)
  }
  configure(preferences) {
    // Serialize opening/closing the device; rapid UI changes cannot leave two
    // live outputs or let an old result replace a newer route.
    this.chain = this.chain.catch(() => {}).then(() => this.apply(preferences))
    return this.chain
  }
  async apply({ precision, deviceName = '' }) {
    await this.fallback()
    if (precision === 'auto') return this.status
    try {
      if (!this.node) {
        await this.context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url))
        this.node = new AudioWorkletNode(this.context, 'lokal-pcm-output', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
        })
        this.node.port.onmessage = event => this.send(event.data)
      }
      const result = await this.api.open({ precision, deviceName, sampleRate: this.context.sampleRate })
      if (!result?.ok) throw new Error(result?.error || 'Native output could not be started.')
      this.session = result.session
      this.frameSize = result.frameSize
      this.source.disconnect(this.context.destination)
      this.source.connect(this.node)
      this.node.connect(this.context.destination)
      this.resetWorklet(true)
      this.report({ ...result, mode: 'native' })
    } catch (error) { await this.fallback(`${error.message} Using Auto output.`) }
    return this.status
  }
  resetWorklet(active) {
    this.epoch++
    this.node?.port.postMessage({ type: 'configure', active, epoch: this.epoch, frameSize: this.frameSize || 1024 })
  }
  async send({ epoch, samples }) {
    if (!this.session || epoch !== this.epoch) return
    const session = this.session
    try {
      const result = await this.api.write(session, samples)
      if (session !== this.session || epoch !== this.epoch) return
      if (!result?.ok) throw new Error(result?.error || 'Native output stopped.')
      this.node.port.postMessage({ type: 'credit', epoch })
    } catch (error) {
      // The same serialized route handles device removal and write failures.
      if (session === this.session) {
        this.session = null
        this.chain = this.chain.catch(() => {}).then(() => this.fallback(`${error.message} Using Auto output.`))
      }
    }
  }
  flush() {
    if (!this.session) return
    this.resetWorklet(true)
    this.api.flush(this.session).catch(() => {})
  }
  async fallback(warning) {
    this.session = null
    this.resetWorklet(false)
    // Silence the native route before reconnecting Chromium to avoid doubled audio.
    try { await this.api.close() } catch {}
    if (this.node) {
      try { this.source.disconnect(this.node) } catch {}
      this.node.disconnect()
    }
    this.source.connect(this.context.destination)
    this.report({ mode: 'auto', sampleRate: this.context.sampleRate, ...(warning ? { warning } : {}) })
  }
}
