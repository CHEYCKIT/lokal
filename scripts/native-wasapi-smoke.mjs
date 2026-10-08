import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

if (process.platform !== 'win32') throw new Error('This smoke test requires Windows WASAPI.')

const require = createRequire(import.meta.url)
const { NativeOutput } = require('../electron/audio/output')
const output = new NativeOutput()
const audio = output.instance()
const devices = output.devices()

assert.equal(devices.available, true, devices.error)
assert.equal(devices.supportsExclusive, true, 'WASAPI exclusive mode is unavailable.')
assert.ok(devices.devices.length > 0, 'No stereo WASAPI output device is available.')

const device = devices.devices.find(candidate => candidate.isDefault) || devices.devices[0]
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

try {
  for (const precision of ['pcm16', 'float32']) {
    const status = output.open({
      precision,
      sampleRate: 48000,
      deviceName: device.name,
      exclusive: true,
    })
    assert.equal(status.ok, true, status.error)
    assert.equal(status.exclusive, true, status.warning)
    assert.equal(status.precision, precision)

    for (let block = 0; block < 48; block++) {
      const samples = new Float32Array(status.frameSize * 2)
      for (let frame = 0; frame < status.frameSize; frame++) {
        const sample = 0.001 * Math.sin((block * status.frameSize + frame) * 2 * Math.PI * 440 / 48000)
        samples[frame * 2] = sample
        samples[frame * 2 + 1] = sample
      }
      assert.equal(output.write(status.session, samples).ok, true)
    }

    const beforeStall = audio.streamTime
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 650)
    assert.ok(audio.streamTime - beforeStall >= 0.5, 'WASAPI render thread stalled with the caller thread.')
    assert.equal(audio.isStreamRunning(), true)

    output.flush(status.session)
    await wait(100)
    for (let block = 0; block < 4; block++) {
      assert.equal(output.write(status.session, new Float32Array(status.frameSize * 2)).ok, true)
      await wait(10)
    }

    audio.discardOutputQueue()
    const deadline = Date.now() + 1000
    while (!audio.isOutputQueueDiscardComplete() && Date.now() < deadline) await wait(10)
    assert.equal(audio.isOutputQueueDiscardComplete(), true, 'WASAPI did not finish discarding queued frames.')
    assert.equal(audio.isStreamRunning(), true)
    output.close()
    console.log(`Passed ${precision} exclusive output on ${device.name}.`)
  }
} finally {
  output.close()
}
