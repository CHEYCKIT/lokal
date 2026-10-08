// This node is deliberately silent: only the native output plays its samples.
// Credits bound messages in flight if either JavaScript thread is busy.
class PCMOutputProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.active = false
    this.epoch = 0
    this.credits = 0
    this.offset = 0
    this.samples = null
    this.port.onmessage = ({ data }) => {
      if (data.type === 'configure') {
        this.active = data.active
        this.session = data.session
        this.epoch = data.epoch
        this.maxCredits = Number.isInteger(data.credits) ? Math.max(1, Math.min(64, data.credits)) : 12
        this.credits = this.maxCredits
        this.offset = 0
        this.samples = new Float32Array(data.frameSize * 2)
        if (this.active) this.transport?.postMessage({ type: 'reset', session: this.session, epoch: this.epoch })
      } else if (data.type === 'transport') {
        this.transport?.close()
        this.transport = data.port
        this.transport.onmessage = ({ data: result }) => {
          if (!this.active || result.epoch !== this.epoch) return
          if (result.ok) this.credits = Math.min(this.maxCredits, this.credits + 1)
          else {
            this.active = false
            this.port.postMessage({ epoch: this.epoch, error: result.error || 'Native output stopped.' })
          }
        }
      } else if (data.type === 'credit' && data.epoch === this.epoch) this.credits = Math.min(this.maxCredits || 12, this.credits + 1)
    }
  }
  process(inputs) {
    if (!this.active || !this.samples) return true
    const input = inputs[0]
    const frames = input?.[0]?.length || 128
    for (let i = 0; i < frames; i++) {
      this.samples[this.offset++] = input?.[0]?.[i] || 0
      this.samples[this.offset++] = input?.[1]?.[i] ?? input?.[0]?.[i] ?? 0
      if (this.offset === this.samples.length) {
        if (this.credits > 0) {
          const samples = this.samples
          const length = samples.length
          const message = { session: this.session, epoch: this.epoch, samples }
          // Electron MessagePortMain accepts cloned typed arrays, but cannot
          // deserialize ArrayBuffers in a browser transfer list.
          if (this.transport) this.transport.postMessage(message)
          else this.port.postMessage(message, [samples.buffer])
          this.samples = new Float32Array(length)
          this.credits--
        }
        this.offset = 0
      }
    }
    return true
  }
}
registerProcessor('lokal-pcm-output', PCMOutputProcessor)
