import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { NativeAudioBridge, normalizePrecision, readOutputPreferences, saveOutputPreferences } from '../src/audio/nativeOutput.js'
const require = createRequire(import.meta.url)
const { NativeOutput, encodePCM, registerNativeOutput } = require('../electron/audio/output')

function fixture(options = {}) {
  const audio = {
    opened: false, running: false, written: [], clears: 0, discards: 0, discardComplete: true, discardedFrames: 0, streamTime: 0,
    getDevices: () => [{ id: 22, name: 'Speakers', isDefaultOutput: true, outputChannels: 2 }],
    open(...args) { this.args = args; if (options.rejectExclusive && args[3]) throw Error('Device busy'); if (options.rejectFloat && args[2] === 32) throw Error('Unsupported float'); this.opened = true; return options.frameSize || 1024 },
    isStreamOpen() { return this.opened }, closeStream() { this.opened = false; this.running = false },
    start() { this.running = true }, isStreamRunning() { return this.running },
    supportsExclusive: () => options.supportsExclusive !== false,
    isExclusive() { return this.args?.[3] === true },
    getStreamSampleRate: () => options.rate || 48000, getApi: () => 'test',
    write(buffer) { this.written.push(buffer) }, clearOutputQueue() { this.clears++; this.written = []; this.discardComplete = true },
    discardOutputQueue() { this.discards++; this.discardComplete = false; this.discardedFrames = 0 },
    isOutputQueueDiscardComplete() { return this.discardComplete },
    getDiscardedFrames() { return this.discardedFrames },
    diagnostic: { underrunFrames: 256, underrunEvents: 2, queuedFrames: 1024, streamTime: 1.5 },
    getDiagnostics() { return this.diagnostic },
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
  // Queue accounting remains intact until the native callback finishes discarding.
  for (let i = 0; i < 29; i++) assert.equal(output.write(status.session, new Float32Array(2048)).ok, true)
  assert.equal(output.queued, 29); assert.equal(output.discardPending, true)
  assert.equal(audio.discards, 1); assert.equal(audio.clears, 0)
  audio.discardedFrames = 28 * output.frameSize
  audio.discardComplete = true
  assert.equal(output.write(status.session, new Float32Array(2048)).ok, true)
  assert.equal(output.queued, 2); assert.equal(output.discardPending, false)
  assert.equal(audio.written.length, 30)
  output.flush(status.session); assert.equal(audio.written.length, 0)
  assert.equal(audio.clears, 1)
  const newer = open('pcm16')
  assert.notEqual(status.session, newer.session)
  assert.equal(output.write(status.session, new Float32Array(2048)).stale, true)
  assert.equal(audio.written.length, 0)
  output.close(); assert.equal(audio.running, false)
})

test('explicit native flush cancels a pending asynchronous discard', () => {
  const { audio, output, open } = fixture()
  const status = open()
  for (let i = 0; i < 29; i++) output.write(status.session, new Float32Array(2048))
  assert.equal(output.discardPending, true)
  output.flush(status.session)
  assert.equal(output.discardPending, false)
  assert.equal(output.queued, 0)
  assert.equal(audio.discardComplete, true)
})

test('native queue trimming stays inside shared and exclusive ring capacities', () => {
  for (const { exclusive, limit, capacity } of [
    { exclusive: false, limit: 28, capacity: 32 },
    { exclusive: true, limit: 120, capacity: 128 },
  ]) {
    const { audio, output } = fixture()
    const status = output.open({ precision: 'float32', sampleRate: 48000, exclusive })
    assert.equal(status.exclusive, exclusive)
    for (let i = 0; i <= limit; i++) {
      assert.equal(output.write(status.session, new Float32Array(2048)).ok, true)
    }
    assert.equal(audio.discards, 1)
    assert.equal(output.queued, limit + 1)
    assert.ok(output.queued < capacity)
  }
})

test('native diagnostics report active output, bounded queue, and underrun counters', () => {
  const { audio, output, open } = fixture()
  assert.deepEqual(output.diagnostics(), {
    active: false, precision: null, exclusive: false, sampleRate: null, frameSize: null,
    deviceName: null, backend: null, queuedBlocks: 0, discardPending: false, queueTrimCount: 0, native: null,
  })
  const status = open()
  assert.equal(output.write(status.session, new Float32Array(2048)).ok, true)
  audio.diagnostic = { ...audio.diagnostic, underrunFrames: 272, underrunEvents: 3 }
  assert.deepEqual(output.diagnostics(), {
    active: true, precision: 'float32', exclusive: false, sampleRate: 48000, frameSize: 1024,
    deviceName: 'Speakers', backend: 'test', queuedBlocks: 1, discardPending: false, queueTrimCount: 0,
    native: { underrunFrames: 16, underrunEvents: 1, queuedFrames: 1024, streamTime: 1.5 },
  })
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
  const status = open()
  audio.running = false
  assert.equal(output.write(status.session, new Float32Array(2048)).ok, false)
  assert.equal(output.session, null)
})

test('native IPC rejects other windows and child frames', () => {
  const handlers = new Map()
  const sender = { mainFrame: {} }
  registerNativeOutput({ handle: (channel, fn) => handlers.set(channel, fn), on: (channel, fn) => handlers.set(channel, fn) }, () => ({ webContents: sender }))
  const close = handlers.get('audio-output:close')
  const diagnostics = handlers.get('audio-output:diagnostics')
  assert.equal(close({ sender: {}, senderFrame: sender.mainFrame }).ok, false)
  assert.equal(close({ sender, senderFrame: {} }).ok, false)
  assert.equal(close({ sender, senderFrame: sender.mainFrame }).ok, true)
  assert.equal(diagnostics({ sender: {}, senderFrame: sender.mainFrame }).ok, false)
  assert.equal(diagnostics({ sender, senderFrame: sender.mainFrame }).active, false)
})

test('worklet accepts the bounded shared and exclusive buffering windows', () => {
  let Processor
  const messages = []
  vm.runInNewContext(fs.readFileSync(new URL('../src/audio/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(structuredClone(message)) } } },
    registerProcessor: (_, implementation) => { Processor = implementation }, Float32Array,
  })
  const processor = new Processor()
  processor.port.onmessage({ data: { type: 'configure', active: true, epoch: 1, frameSize: 128, credits: 64, pendingBlocks: 48 } })
  for (let i = 0; i < 66; i++) processor.process([[new Float32Array(128), new Float32Array(128)]])
  assert.equal(messages.length, 64)
  assert.equal(processor.pendingCount, 2)
  processor.port.onmessage({ data: { type: 'credit', epoch: 1 } })
  processor.process([[new Float32Array(128), new Float32Array(128)]])
  assert.equal(messages.length, 65)
})

test('exclusive worklet backlog fits its native ring and drops the oldest stalled audio', () => {
  let Processor
  const sent = []
  vm.runInNewContext(fs.readFileSync(new URL('../src/audio/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => sent.push(structuredClone(message)) } } },
    registerProcessor: (_, implementation) => { Processor = implementation }, Float32Array,
  })
  const processor = new Processor()
  processor.port.onmessage({ data: { type: 'configure', active: true, epoch: 1, frameSize: 1024, credits: 64, pendingBlocks: 48 } })
  const emitBlock = index => {
    for (let frame = 0; frame < 8; frame++) processor.process([[new Float32Array(128).fill(index)]])
  }
  for (let i = 1; i <= 120; i++) emitBlock(i)
  assert.equal(sent.length, 64)
  assert.equal(processor.pendingCount, 48)
  assert.ok(64 + processor.pendingCount <= 131072 / 1024)

  for (let i = 0; i < 48; i++) processor.port.onmessage({ data: { type: 'credit', epoch: 1 } })
  assert.equal(processor.pendingCount, 0)
  assert.deepEqual(sent.map(message => message.samples[0]), [
    ...Array.from({ length: 64 }, (_, i) => i + 1),
    ...Array.from({ length: 48 }, (_, i) => i + 73),
  ])
})

test('worklet buffers PCM while native credits are delayed and drains it in order', () => {
  let Processor
  const messages = []
  vm.runInNewContext(fs.readFileSync(new URL('../src/audio/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(structuredClone(message)) } } },
    registerProcessor: (_, implementation) => { Processor = implementation }, Float32Array,
  })
  const processor = new Processor()
  processor.port.onmessage({ data: { type: 'configure', active: true, epoch: 1, frameSize: 128, credits: 1, pendingBlocks: 2 } })
  for (let i = 1; i <= 3; i++) processor.process([[new Float32Array(128).fill(i)]])
  assert.equal(messages.length, 1)
  assert.equal(processor.pendingCount, 2)
  processor.port.onmessage({ data: { type: 'credit', epoch: 1 } })
  processor.port.onmessage({ data: { type: 'credit', epoch: 1 } })
  assert.equal(messages.length, 3)
  assert.deepEqual(messages.map(message => message.samples[0]), [1, 2, 3])
  assert.equal(processor.pendingCount, 0)
})

test('worklet replaces stale queued PCM when the pending queue is full', () => {
  let Processor
  const messages = []
  vm.runInNewContext(fs.readFileSync(new URL('../src/audio/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(structuredClone(message)) } } },
    registerProcessor: (_, implementation) => { Processor = implementation }, Float32Array,
  })
  const processor = new Processor()
  processor.port.onmessage({ data: { type: 'configure', active: true, epoch: 1, frameSize: 128, credits: 1, pendingBlocks: 2 } })
  for (let i = 1; i <= 4; i++) processor.process([[new Float32Array(128).fill(i)]])
  assert.equal(processor.pendingCount, 2)
  processor.port.onmessage({ data: { type: 'credit', epoch: 1 } })
  processor.port.onmessage({ data: { type: 'credit', epoch: 1 } })
  assert.deepEqual(messages.map(message => message.samples[0]), [1, 3, 4])
  assert.equal(processor.pendingCount, 0)
})

test('worklet accepts a deeper credit window for exclusive output', () => {
  let Processor
  const messages = []
  vm.runInNewContext(fs.readFileSync(new URL('../src/audio/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(structuredClone(message)) } } },
    registerProcessor: (_, implementation) => { Processor = implementation }, Float32Array,
  })
  const processor = new Processor()
  processor.port.onmessage({ data: { type: 'configure', active: true, epoch: 1, frameSize: 128, credits: 48 } })
  for (let i = 0; i < 50; i++) processor.process([[new Float32Array(128), new Float32Array(128)]])
  assert.equal(messages.length, 48)
  processor.port.onmessage({ data: { type: 'credit', epoch: 1 } })
  processor.process([[new Float32Array(128), new Float32Array(128)]])
  assert.equal(messages.length, 49)
})

test('worklet output stays non-zero but inaudible so Chromium keeps the real device clock', () => {
  let Processor
  vm.runInNewContext(fs.readFileSync(new URL('../src/audio/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} } } },
    registerProcessor: (_, implementation) => { Processor = implementation }, Float32Array,
  })
  const processor = new Processor()
  const outputs = [[new Float32Array(128), new Float32Array(128)]]
  processor.process([[new Float32Array(128).fill(.5)]], outputs)
  assert.ok(outputs[0].every(channel => channel.every(sample => sample === 0)))
  processor.port.onmessage({ data: { type: 'configure', active: true, epoch: 1, frameSize: 128 } })
  processor.process([[new Float32Array(128).fill(.5)]], outputs)
  // Any non-zero sample defeats SilentSinkSuspender; stay below 24-bit LSB.
  assert.ok(outputs[0].every(channel => channel.every(sample => sample !== 0 && Math.abs(sample) < 2 ** -24)))
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
  for (let i = 0; i < 14; i++) processor.process([[new Float32Array(128).fill(.25), new Float32Array(128).fill(.5)]])
  assert.equal(messages.length, 12)
  assert.deepEqual(Array.from(messages[0].samples.slice(0, 4)), [.25, .5, .25, .5])
  processor.port.onmessage({ data: { type: 'credit', epoch: 0 } }); processor.process([])
  assert.equal(messages.length, 12)
  processor.port.onmessage({ data: { type: 'configure', active: false, epoch: 2, frameSize: 128 } }); processor.process([])
  assert.equal(messages.length, 12)
})

function bridgeFixture(t, playing = true) {
  const destination = {}, routes = new Set([destination]), sent = [], calls = []
  const context = { sampleRate: 48000, destination, state: 'suspended',
    suspend: async () => { context.state = 'suspended' }, resume: async () => { context.state = 'running' },
    audioWorklet: { addModule: async () => {} } }
  const source = { connect: node => routes.add(node), disconnect: node => routes.delete(node) }
  globalThis.AudioWorkletNode = class { constructor() { this.port = { postMessage: message => sent.push(message) } } connect() {} disconnect() {} }
  t.after(() => delete globalThis.AudioWorkletNode)
  const api = {
    open: async ({ precision, exclusive }) => { calls.push('open'); return { ok: true, session: precision, precision, exclusive, frameSize: 128, sampleRate: 48000, channels: 2 } },
    close: async () => { calls.push('close') }, flush: async () => { calls.push('flush') }, write: async () => ({ ok: true }),
  }
  const bridge = new NativeAudioBridge(context, source, api)
  bridge.playing = playing
  return { bridge, api, routes, destination, sent, calls }
}

test('bridge serializes format changes and returns exclusively to browser output on Auto', async t => {
  const { bridge, routes, destination, calls } = bridgeFixture(t)
  await Promise.all([bridge.configure({ precision: 'float32' }), bridge.configure({ precision: 'pcm16' })])
  assert.equal(bridge.status.precision, 'pcm16'); assert.equal(routes.has(destination), false); assert.equal(routes.size, 1)
  bridge.flush()
  await bridge.configure({ precision: 'auto' })
  assert.equal(routes.size, 1); assert.ok(routes.has(destination)); assert.equal(bridge.session, null)
  assert.deepEqual(calls, ['close', 'open', 'flush', 'close'])
})

test('production bridge forces shared mode and bounded buffering', async t => {
  const { bridge, api, sent } = bridgeFixture(t)
  let requestedExclusive
  api.open = async options => {
    requestedExclusive = options.exclusive
    return { ok: true, session: 'shared', exclusive: false, frameSize: 128 }
  }
  await bridge.configure({ precision: 'float32', exclusive: true })
  const config = sent.filter(message => message.type === 'configure' && message.active).at(-1)
  assert.equal(requestedExclusive, false)
  assert.equal(bridge.preferences.exclusive, false)
  assert.equal(config.credits, 24)
  assert.equal(config.pendingBlocks, 8)
})

test('idle Auto keeps Chromium on its normal output and releases native routes on pause', async t => {
  const { bridge, api, calls } = bridgeFixture(t, false)
  const sinks = []
  bridge.context.sinkId = 'system-speaker'
  bridge.context.setSinkId = async value => {
    sinks.push(value)
    bridge.context.sinkId = value
  }
  await bridge.configure({ precision: 'float32' })
  assert.deepEqual(sinks, [])
  assert.equal(bridge.context.state, 'suspended')
  assert.equal(calls.includes('open'), false)

  api.open = async () => ({ ok: true, session: 'native', exclusive: false, frameSize: 128 })
  await bridge.setPlaying(true)
  assert.deepEqual(sinks, [])
  await bridge.setPlaying(false)
  assert.equal(bridge.context.state, 'suspended')
  assert.equal(bridge.context.sinkId, 'system-speaker')
  assert.deepEqual(sinks, [])
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

test('legacy exclusive preference keeps Chromium on the shared speaker route', async t => {
  const { bridge, api } = bridgeFixture(t)
  const calls = []
  bridge.context.sinkId = 'old-speaker'
  bridge.browserDeviceId = 'selected-speaker'
  bridge.context.setSinkId = async sink => { calls.push(sink); bridge.context.sinkId = sink }
  api.open = async options => {
    assert.equal(options.exclusive, false)
    return { ok: true, session: 'shared', exclusive: false, frameSize: 128 }
  }
  await bridge.configure({ precision: 'float32', exclusive: true })
  assert.deepEqual(calls, [])
  await bridge.configure({ precision: 'auto' })
  assert.deepEqual(calls, [])
})

test('failed native opening restores browser playback', async t => {
  const { bridge, api, routes, destination } = bridgeFixture(t)
  const sinks = []
  bridge.context.setSinkId = async value => sinks.push(value)
  api.open = async () => ({ ok: false, error: 'Device busy' })
  await bridge.configure({ precision: 'pcm16', exclusive: true })
  assert.deepEqual(sinks, [])
  assert.equal(bridge.status.mode, 'auto')
  assert.ok(routes.has(destination))
  assert.match(bridge.status.warning, /Device busy/)
})

test('stale exclusive preferences are discarded when read and saved', async t => {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map([['lokal-output-precision', JSON.stringify({ precision: 'float32', deviceName: 'speaker', exclusive: true })]])
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  } })
  try {
    const preferences = readOutputPreferences()
    assert.deepEqual(preferences, { precision: 'float32', deviceName: 'speaker', exclusive: false })
    saveOutputPreferences({ ...preferences, exclusive: true })
    assert.equal(JSON.parse(values.get('lokal-output-precision')).exclusive, false)
  } finally {
    if (previousDescriptor) Object.defineProperty(globalThis, 'localStorage', previousDescriptor)
    else delete globalThis.localStorage
  }
})

test('shared native output does not change the selected Chromium speaker', async t => {
  const { bridge, api } = bridgeFixture(t)
  const sinks = []
  bridge.browserDeviceId = 'speaker'
  bridge.context.setSinkId = async value => sinks.push(value)
  await bridge.configure({ precision: 'pcm16', exclusive: true })
  assert.deepEqual(sinks, [])
  assert.equal(bridge.status.mode, 'native')
})

test('idle preferences never open a device; pause releases native and Chromium outputs, resume restores preference', async t => {
  for (const precision of ['auto', 'pcm16', 'float32']) {
    const { bridge, calls } = bridgeFixture(t, false)
    await bridge.configure({ precision, exclusive: true })
    assert.equal(calls.includes('open'), false)
    assert.equal(bridge.context.state, 'suspended')
    assert.equal(bridge.status.mode, 'idle')
    bridge.context.setSinkId = async () => {}
    await bridge.setPlaying(true)
    assert.equal(bridge.context.state, 'running')
    assert.equal(bridge.status.mode, precision === 'auto' ? 'auto' : 'native')
    await bridge.setPlaying(false)
    assert.equal(bridge.context.state, 'suspended')
    assert.equal(bridge.session, null)
    assert.equal(bridge.status.mode, 'idle')
    assert.equal(calls.at(-1), 'close')
    await bridge.setPlaying(true)
    assert.equal(bridge.status.mode, precision === 'auto' ? 'auto' : 'native')
  }
})

test('pausing during device negotiation cannot leave an exclusive stream open', async t => {
  const { bridge, api, calls } = bridgeFixture(t, false)
  bridge.context.setSinkId = async () => {}
  let finish, entered
  const opening = new Promise(resolve => { entered = resolve })
  api.open = () => { entered(); return new Promise(resolve => { finish = resolve }) }
  await bridge.configure({ precision: 'float32', exclusive: true })
  const starting = bridge.setPlaying(true)
  await opening
  const stopping = bridge.setPlaying(false)
  finish({ ok: true, session: 'late', frameSize: 128, exclusive: true })
  await Promise.all([starting, stopping])
  assert.equal(bridge.session, null)
  assert.equal(bridge.context.state, 'suspended')
  assert.equal(bridge.status.mode, 'idle')
  assert.equal(calls.at(-1), 'close')
})

test('native shared output keeps Chromium connected to the speaker clock', async t => {
  const { bridge, api } = bridgeFixture(t)
  const sinks = []
  bridge.context.setSinkId = async value => sinks.push(value)
  api.open = async options => {
    assert.equal(sinks.length, 0, 'shared WASAPI mode keeps Chromium connected to its output clock')
    assert.equal(options.exclusive, false)
    return { ok: true, session: 'shared', frameSize: 128 }
  }
  await bridge.configure({ precision: 'float32' })
  assert.deepEqual(sinks, [])
  await bridge.setPlaying(false)
  assert.equal(bridge.context.state, 'suspended')
  assert.deepEqual(sinks, [])
})

test('idle Auto preserves the browser sink and resumes without switching devices', async t => {
  const { bridge } = bridgeFixture(t, false)
  const sinks = []
  bridge.context.sinkId = 'original-speaker'
  bridge.context.setSinkId = async value => { sinks.push(value); bridge.context.sinkId = value }
  await bridge.configure({ precision: 'auto' })
  assert.deepEqual(sinks, [])
  await bridge.setPlaying(true)
  assert.equal(sinks.length, 0)
  await bridge.setPlaying(false)
  assert.equal(sinks.length, 0)
  assert.equal(bridge.context.state, 'suspended')
})

test('native transitions preserve the selected browser sink', async t => {
  const { bridge } = bridgeFixture(t)
  const sinks = []
  bridge.browserDeviceId = 'selected-speaker'
  bridge.context.sinkId = 'selected-speaker'
  bridge.context.setSinkId = async value => { sinks.push(value); bridge.context.sinkId = value }
  bridge.api.open = async ({ precision }) => ({ ok: true, session: precision, precision, exclusive: false, frameSize: 128 })
  await bridge.configure({ precision: 'float32', exclusive: true })
  assert.deepEqual(sinks, [])
  await bridge.configure({ precision: 'pcm16', exclusive: true })
  assert.deepEqual(sinks, [])
  await bridge.configure({ precision: 'auto' })
  assert.deepEqual(sinks, [])
})

test('Auto leaves the browser-selected speaker unchanged', async t => {
  const { bridge } = bridgeFixture(t, false)
  const sinks = []
  bridge.context.sinkId = 'new-speaker'
  bridge.context.setSinkId = async value => sinks.push(value)
  await bridge.configure({ precision: 'auto' })
  bridge.browserDeviceId = 'new-speaker'
  await bridge.setPlaying(true)
  assert.deepEqual(sinks, [])
  assert.equal(bridge.context.sinkId, 'new-speaker')
  assert.equal(bridge.context.state, 'running')
})

test('worklet delivers PCM and receives credits directly without renderer callbacks; stale replies ignored', () => {
  let Processor
  const renderer = [], direct = []
  vm.runInNewContext(fs.readFileSync(new URL('../src/audio/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => renderer.push(message) } } },
    registerProcessor: (_, implementation) => { Processor = implementation }, Float32Array,
  })
  const processor = new Processor()
  const port = { postMessage: message => direct.push(structuredClone(message)) }
  processor.port.onmessage({ data: { type: 'transport', port } })
  processor.port.onmessage({ data: { type: 'configure', active: true, session: 's', epoch: 1, frameSize: 128, credits: 1 } })
  assert.deepEqual(direct.shift(), { type: 'reset', session: 's', epoch: 1 })
  const block = [[new Float32Array(128).fill(.25), new Float32Array(128).fill(.5)]]
  processor.process(block)
  assert.equal(direct.length, 1)
  assert.equal(direct[0].session, 's')
  assert.deepEqual(Array.from(direct[0].samples.slice(0, 4)), [.25, .5, .25, .5])
  port.onmessage({ data: { epoch: 0, ok: true } })
  processor.process(block)
  assert.equal(direct.length, 1)
  port.onmessage({ data: { epoch: 1, ok: true } })
  processor.process(block)
  assert.equal(direct.length, 2)
  assert.equal(renderer.length, 0)
  port.onmessage({ data: { epoch: 1, ok: false, error: 'Unplugged' } })
  assert.equal(renderer[0].error, 'Unplugged')
  processor.process(block)
  assert.equal(direct.length, 2)
})

test('direct PCM transport rejects foreign windows/frames and closes rejected ports', () => {
  const handlers = new Map(), sender = { mainFrame: {} }
  registerNativeOutput({ handle() {}, on: (name, fn) => handlers.set(name, fn) }, () => ({ webContents: sender }))
  let closed = 0
  const port = { close: () => closed++ }
  handlers.get('audio-output:connect')({ sender: {}, senderFrame: sender.mainFrame, ports: [port] })
  handlers.get('audio-output:connect')({ sender, senderFrame: {}, ports: [port] })
  assert.equal(closed, 2)
})

test('idle preferences never open a device; pause releases native and Chromium outputs, resume restores preference', async t => {
  for (const precision of ['auto', 'pcm16', 'float32']) {
    const { bridge, calls } = bridgeFixture(t, false)
    await bridge.configure({ precision, exclusive: true })
    assert.equal(calls.includes('open'), false)
    assert.equal(bridge.context.state, 'suspended')
    assert.equal(bridge.status.mode, 'idle')
    bridge.context.setSinkId = async () => {}
    await bridge.setPlaying(true)
    assert.equal(bridge.context.state, 'running')
    assert.equal(bridge.status.mode, precision === 'auto' ? 'auto' : 'native')
    await bridge.setPlaying(false)
    assert.equal(bridge.context.state, 'suspended')
    assert.equal(bridge.session, null)
    assert.equal(bridge.status.mode, 'idle')
    assert.equal(calls.at(-1), 'close')
    await bridge.setPlaying(true)
    assert.equal(bridge.status.mode, precision === 'auto' ? 'auto' : 'native')
  }
})

test('pausing during device negotiation cannot leave an exclusive stream open', async t => {
  const { bridge, api, calls } = bridgeFixture(t, false)
  bridge.context.setSinkId = async () => {}
  let finish, entered
  const opening = new Promise(resolve => { entered = resolve })
  api.open = () => { entered(); return new Promise(resolve => { finish = resolve }) }
  await bridge.configure({ precision: 'float32', exclusive: true })
  const starting = bridge.setPlaying(true)
  await opening
  const stopping = bridge.setPlaying(false)
  finish({ ok: true, session: 'late', frameSize: 128, exclusive: true })
  await Promise.all([starting, stopping])
  assert.equal(bridge.session, null)
  assert.equal(bridge.context.state, 'suspended')
  assert.equal(bridge.status.mode, 'idle')
  assert.equal(calls.at(-1), 'close')
})

test('native shared output keeps Chromium connected to the speaker clock', async t => {
  const { bridge, api } = bridgeFixture(t)
  const sinks = []
  bridge.context.setSinkId = async value => sinks.push(value)
  api.open = async options => {
    assert.deepEqual(sinks, [])
    assert.equal(options.exclusive, false)
    return { ok: true, session: 'shared', frameSize: 128 }
  }
  await bridge.configure({ precision: 'float32' })
  assert.deepEqual(sinks, [])
  await bridge.setPlaying(false)
  assert.equal(bridge.context.state, 'suspended')
  assert.deepEqual(sinks, [])
})

test('Auto preserves the speaker selected while output was idle', async t => {
  const { bridge } = bridgeFixture(t, false)
  const sinks = []
  bridge.context.sinkId = 'new-speaker'
  bridge.context.setSinkId = async value => sinks.push(value)
  await bridge.configure({ precision: 'auto' })
  bridge.browserDeviceId = 'new-speaker'
  await bridge.setPlaying(true)
  assert.deepEqual(sinks, [])
  assert.equal(bridge.context.sinkId, 'new-speaker')
  assert.equal(bridge.context.state, 'running')
})

test('worklet delivers PCM and receives credits directly without renderer callbacks; stale replies ignored', () => {
  let Processor
  const renderer = [], direct = []
  vm.runInNewContext(fs.readFileSync(new URL('../src/audio/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => renderer.push(message) } } },
    registerProcessor: (_, implementation) => { Processor = implementation }, Float32Array,
  })
  const processor = new Processor()
  const port = { postMessage: message => direct.push(structuredClone(message)) }
  processor.port.onmessage({ data: { type: 'transport', port } })
  processor.port.onmessage({ data: { type: 'configure', active: true, session: 's', epoch: 1, frameSize: 128, credits: 1 } })
  assert.deepEqual(direct.shift(), { type: 'reset', session: 's', epoch: 1 })
  const block = [[new Float32Array(128).fill(.25), new Float32Array(128).fill(.5)]]
  processor.process(block)
  assert.equal(direct.length, 1)
  assert.equal(direct[0].session, 's')
  assert.deepEqual(Array.from(direct[0].samples.slice(0, 4)), [.25, .5, .25, .5])
  port.onmessage({ data: { epoch: 0, ok: true } })
  processor.process(block)
  assert.equal(direct.length, 1)
  port.onmessage({ data: { epoch: 1, ok: true } })
  processor.process(block)
  assert.equal(direct.length, 2)
  assert.equal(renderer.length, 0)
  port.onmessage({ data: { epoch: 1, ok: false, error: 'Unplugged' } })
  assert.equal(renderer[0].error, 'Unplugged')
  processor.process(block)
  assert.equal(direct.length, 2)
})

test('direct PCM transport rejects foreign windows/frames and closes rejected ports', () => {
  const handlers = new Map(), sender = { mainFrame: {} }
  registerNativeOutput({ handle() {}, on: (name, fn) => handlers.set(name, fn) }, () => ({ webContents: sender }))
  let closed = 0
  const port = { close: () => closed++ }
  handlers.get('audio-output:connect')({ sender: {}, senderFrame: sender.mainFrame, ports: [port] })
  handlers.get('audio-output:connect')({ sender, senderFrame: {}, ports: [port] })
  assert.equal(closed, 2)
})
