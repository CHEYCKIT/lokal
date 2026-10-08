import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { NativeAudioBridge, normalizePrecision, readOutputPreferences } from '../src/audio/nativeOutput.js'
const require = createRequire(import.meta.url)
const { NativeOutput, encodePCM, registerNativeOutput } = require('../electron/audio/output')

function fixture(options = {}) {
  const audio = {
    opened: false, running: false, written: [], clears: 0, streamTime: 0,
    getDevices: () => [{ id: 22, name: 'Speakers', isDefaultOutput: true, outputChannels: 2 }],
    open(...args) { this.args = args; if (options.rejectExclusive && args[3]) throw Error('Device busy'); if (options.rejectFloat && args[2] === 32) throw Error('Unsupported float'); this.opened = true; return options.frameSize || 1024 },
    isStreamOpen() { return this.opened }, closeStream() { this.opened = false; this.running = false },
    start() { this.running = true }, isStreamRunning() { return this.running },
    supportsExclusive: () => options.supportsExclusive !== false,
    isExclusive() { return this.args?.[3] === true },
    getStreamSampleRate: () => options.rate || 48000, getApi: () => 'test',
    write(buffer) { this.written.push(buffer) }, clearOutputQueue() { this.clears++; this.written = [] },
  }
  const output = new NativeOutput(() => audio)
  return { audio, output, open: precision => output.open({ precision: precision || 'float32', sampleRate: 48000 }) }
}

test('PCM encoding preserves float samples and clamps/dithers 16-bit only at the final boundary', () => {
  const samples = Float32Array.of(-2, -1, -.5, 0, .5, 1, 2, NaN, Infinity)
  const float = encodePCM(samples, 'float32')
  assert.deepEqual(Array.from({ length: 9 }, (_, i) => float.readFloatLE(i * 4)), [-2, -1, -.5, 0, .5, 1, 2, 0, 0])
  const int = encodePCM(samples, 'pcm16', () => .5)
  assert.deepEqual(Array.from({ length: 9 }, (_, i) => int.readInt16LE(i * 2)), [-32768, -32768, -16384, 0, 16384, 32767, 32767, 0, 0])
  let value = 0
  assert.equal(encodePCM(Float32Array.of(0), 'pcm16', () => (++value % 2 ? .9 : .1)).readInt16LE(0), 1)
})

test('negotiates stereo format, uses device id, bounds queue, rejects stale and invalid frames', () => {
  const { audio, output, open } = fixture()
  const status = open()
  assert.equal(status.ok, true); assert.equal(status.precision, 'float32'); assert.equal(audio.args[0], 22)
  assert.equal(output.write('stale', new Float32Array(2048)).stale, true)
  assert.equal(output.write(status.session, new Float32Array(2)).ok, false)
  for (let i = 0; i < 20; i++) assert.equal(output.write(status.session, new Float32Array(2048)).ok, true)
  assert.ok(output.queued <= 6); assert.ok(audio.clears > 0)
  output.flush(status.session); assert.equal(audio.written.length, 0)
  const newer = open('pcm16')
  assert.notEqual(status.session, newer.session)
  assert.equal(output.write(status.session, new Float32Array(2048)).stale, true)
  assert.equal(audio.written.length, 0)
  output.close(); assert.equal(audio.running, false)
})

test('unsupported float falls back truthfully; unsupported rates cannot change playback pitch', () => {
  const fallback = fixture({ rejectFloat: true }).open()
  assert.equal(fallback.precision, 'pcm16'); assert.match(fallback.warning, /Using 16-bit/)
  assert.equal(fixture({ rate: 44100 }).open().ok, false)
  assert.equal(fixture({ frameSize: 32768 }).open().ok, false)
})

test('missing dependency, unavailable device, invalid config and device stop are recoverable', () => {
  const absent = new NativeOutput(() => { throw Error('missing') })
  assert.equal(absent.devices().available, false)
  assert.equal(absent.open({ precision: 'float32', sampleRate: 48000 }).ok, false)
  const { output, audio, open } = fixture()
  assert.equal(output.open({ precision: 'float32', sampleRate: 48000, deviceName: 'unplugged' }).ok, false)
  assert.equal(output.open({ precision: 'bad', sampleRate: 48000 }).ok, false)
  const status = open(); audio.running = false
  assert.equal(output.write(status.session, new Float32Array(2048)).ok, false)
  assert.equal(output.session, null)
})

test('native IPC rejects other windows and child frames', () => {
  const handlers = new Map()
  const sender = { mainFrame: {} }
  registerNativeOutput({ handle: (channel, fn) => handlers.set(channel, fn) }, () => ({ webContents: sender }))
  const close = handlers.get('audio-output:close')
  assert.equal(close({ sender: {}, senderFrame: sender.mainFrame }).ok, false)
  assert.equal(close({ sender, senderFrame: {} }).ok, false)
  assert.equal(close({ sender, senderFrame: sender.mainFrame }).ok, true)
})

test('worklet interleaves stereo, sends no audible output, bounds messages and discards partial frames on reset', () => {
  let Processor
  const messages = []
  vm.runInNewContext(fs.readFileSync(new URL('../src/audio/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(structuredClone(message)) } } },
    registerProcessor: (_, implementation) => { Processor = implementation }, Float32Array,
  })
  const processor = new Processor()
  processor.port.onmessage({ data: { type: 'configure', active: true, epoch: 1, frameSize: 128 } })
  for (let i = 0; i < 10; i++) processor.process([[new Float32Array(128).fill(.25), new Float32Array(128).fill(.5)]])
  assert.equal(messages.length, 3)
  assert.deepEqual(Array.from(messages[0].samples.slice(0, 4)), [.25, .5, .25, .5])
  processor.port.onmessage({ data: { type: 'credit', epoch: 0 } }); processor.process([])
  assert.equal(messages.length, 3)
  processor.port.onmessage({ data: { type: 'configure', active: false, epoch: 2, frameSize: 128 } }); processor.process([])
  assert.equal(messages.length, 3)
})

function bridgeFixture(t) {
  const destination = {}, routes = new Set([destination]), sent = [], calls = []
  const context = { sampleRate: 48000, destination, audioWorklet: { addModule: async () => {} } }
  const source = { connect: node => routes.add(node), disconnect: node => routes.delete(node) }
  globalThis.AudioWorkletNode = class { constructor() { this.port = { postMessage: message => sent.push(message) } } connect() {} disconnect() {} }
  t.after(() => delete globalThis.AudioWorkletNode)
  const api = {
    open: async ({ precision }) => { calls.push('open'); return { ok: true, session: precision, precision, frameSize: 128, sampleRate: 48000, channels: 2 } },
    close: async () => { calls.push('close') }, flush: async () => { calls.push('flush') }, write: async () => ({ ok: true }),
  }
  const bridge = new NativeAudioBridge(context, source, api)
  return { bridge, api, routes, destination, sent, calls }
}

test('bridge serializes format changes and returns exclusively to browser output on Auto', async t => {
  const { bridge, routes, destination, calls } = bridgeFixture(t)
  await Promise.all([bridge.configure({ precision: 'float32' }), bridge.configure({ precision: 'pcm16' })])
  assert.equal(bridge.status.precision, 'pcm16'); assert.equal(routes.has(destination), false); assert.equal(routes.size, 1)
  bridge.flush()
  await bridge.configure({ precision: 'auto' })
  assert.equal(routes.size, 1); assert.ok(routes.has(destination)); assert.equal(bridge.session, null)
  assert.deepEqual(calls, ['close', 'open', 'close', 'open', 'flush', 'close'])
})

test('bridge preserves browser playback when open fails and restores it on write failure', async t => {
  const { bridge, api, routes, destination } = bridgeFixture(t)
  api.open = async () => ({ ok: false, error: 'Unsupported device' })
  await bridge.configure({ precision: 'float32' })
  assert.equal(bridge.status.mode, 'auto'); assert.ok(routes.has(destination)); assert.match(bridge.status.warning, /Unsupported device/)
  api.open = async () => ({ ok: true, session: 's', frameSize: 128 })
  await bridge.configure({ precision: 'float32' })
  api.write = async () => ({ ok: false, error: 'Disconnected' })
  await bridge.send({ epoch: bridge.epoch, samples: new Float32Array(256) })
  await bridge.chain
  assert.ok(routes.has(destination)); assert.match(bridge.status.warning, /Disconnected/)
})

test('precision preferences default safely when storage is unavailable or invalid', () => {
  assert.equal(normalizePrecision('invalid'), 'auto')
  assert.deepEqual(readOutputPreferences(), { precision: 'auto', deviceName: '', exclusive: false })
})

test('exclusive opens before shared; busy device falls back truthfully and preference input is checked', () => {
  const available = fixture()
  const exclusive = available.output.open({ precision: 'float32', sampleRate: 48000, exclusive: true })
  assert.equal(exclusive.exclusive, true)
  assert.equal(available.audio.args[3], true)
  const busy = fixture({ rejectExclusive: true })
  const fallback = busy.output.open({ precision: 'float32', sampleRate: 48000, exclusive: true })
  assert.equal(fallback.ok, true); assert.equal(fallback.exclusive, false)
  assert.match(fallback.warning, /Using shared output/)
  const otherOS = fixture({ supportsExclusive: false })
  assert.equal(otherOS.output.open({ precision: 'pcm16', sampleRate: 48000, exclusive: true }).exclusive, false)
  assert.equal(otherOS.output.open({ precision: 'pcm16', sampleRate: 48000, exclusive: 'yes' }).ok, false)
})

test('exclusive mode releases Chromium speaker before opening and restores the chosen speaker on fallback', async t => {
  const { bridge, api, destination, routes } = bridgeFixture(t)
  const calls = []
  bridge.context.sinkId = 'old-speaker'
  bridge.browserDeviceId = 'selected-speaker'
  bridge.context.setSinkId = async sink => { calls.push(sink); bridge.context.sinkId = sink }
  api.open = async options => {
    assert.deepEqual(calls.at(-1), { type: 'none' })
    assert.equal(options.exclusive, true)
    return { ok: true, session: 'exclusive', exclusive: true, frameSize: 128 }
  }
  await bridge.configure({ precision: 'float32', exclusive: true })
  assert.equal(bridge.silentSink, true)
  assert.equal(routes.has(destination), false)
  await bridge.configure({ precision: 'auto' })
  assert.equal(calls.at(-1), 'selected-speaker')
  assert.equal(bridge.silentSink, false)
  assert.equal(routes.has(destination), true)
})

test('failed exclusive opening restores browser sink and playback', async t => {
  const { bridge, api, routes, destination } = bridgeFixture(t)
  const sinks = []
  bridge.context.setSinkId = async value => sinks.push(value)
  api.open = async () => ({ ok: false, error: 'Device busy' })
  await bridge.configure({ precision: 'pcm16', exclusive: true })
  assert.equal(sinks.at(-1), '')
  assert.equal(bridge.status.mode, 'auto')
  assert.ok(routes.has(destination))
  assert.match(bridge.status.warning, /Device busy/)
})

test('fallback restores system default when the former browser speaker is unplugged', async t => {
  const { bridge, api } = bridgeFixture(t)
  bridge.browserDeviceId = 'unplugged'
  const sinks = []
  bridge.context.setSinkId = async value => { sinks.push(value); if (value === 'unplugged') throw Error('Not found') }
  api.open = async () => ({ ok: false, error: 'Unavailable' })
  await bridge.configure({ precision: 'pcm16', exclusive: true })
  assert.equal(sinks.at(-1), '')
  assert.equal(bridge.status.mode, 'auto')
})
