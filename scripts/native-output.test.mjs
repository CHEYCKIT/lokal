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
    opened: false, running: false, written: [], clears: 0, discards: 0, streamTime: 0,
    getDevices: () => [{ id: 22, name: 'Speakers', isDefaultOutput: true, outputChannels: 2 }],
    open(...args) { this.args = args; if (options.rejectExclusive && args[3]) throw Error('Device busy'); if (options.rejectFloat && args[2] === 32) throw Error('Unsupported float'); this.opened = true; return options.frameSize || 1024 },
    isStreamOpen() { return this.opened }, closeStream() { this.opened = false; this.running = false },
    start() { this.running = true }, isStreamRunning() { return this.running },
    supportsExclusive: () => options.supportsExclusive !== false,
    isExclusive() { return this.args?.[3] === true },
    getStreamSampleRate: () => options.rate || 48000, getApi: () => 'test',
    write(buffer) { this.written.push(buffer) }, clearOutputQueue() { this.clears++; this.written = [] },
    discardOutputQueue() { this.discards++; this.written = [] },
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
  // Overload trims queued PCM without stopping and restarting the device.
  for (let i = 0; i < 25; i++) assert.equal(output.write(status.session, new Float32Array(2048)).ok, true)
  assert.ok(output.queued <= 24); assert.ok(audio.discards > 0); assert.equal(audio.clears, 0)
  output.flush(status.session); assert.equal(audio.written.length, 0)
  assert.equal(audio.clears, 1)
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
  registerNativeOutput({ handle: (channel, fn) => handlers.set(channel, fn), on: (channel, fn) => handlers.set(channel, fn) }, () => ({ webContents: sender }))
  const close = handlers.get('audio-output:close')
  assert.equal(close({ sender: {}, senderFrame: sender.mainFrame }).ok, false)
  assert.equal(close({ sender, senderFrame: {} }).ok, false)
  assert.equal(close({ sender, senderFrame: sender.mainFrame }).ok, true)
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
    open: async ({ precision }) => { calls.push('open'); return { ok: true, session: precision, precision, frameSize: 128, sampleRate: 48000, channels: 2 } },
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

test('native shared output also releases the extra Chromium speaker', async t => {
  const { bridge, api } = bridgeFixture(t)
  const sinks = []
  bridge.context.setSinkId = async value => sinks.push(value)
  api.open = async options => {
    assert.deepEqual(sinks.at(-1), { type: 'none' })
    assert.equal(bridge.status.mode, 'switching', 'do not restart the SMTC shared speaker during native negotiation')
    assert.equal(options.exclusive, false)
    return { ok: true, session: 'shared', frameSize: 128 }
  }
  await bridge.configure({ precision: 'float32' })
  assert.equal(bridge.silentSink, true)
  await bridge.setPlaying(false)
  assert.equal(bridge.context.state, 'suspended')
  assert.deepEqual(sinks.at(-1), { type: 'none' })
})

test('idle Auto releases Chromium output and restores the original sink on playback', async t => {
  const { bridge } = bridgeFixture(t, false)
  const sinks = []
  bridge.context.sinkId = 'original-speaker'
  bridge.context.setSinkId = async value => { sinks.push(value); bridge.context.sinkId = value }
  await bridge.configure({ precision: 'auto' })
  assert.deepEqual(sinks, [{ type: 'none' }])
  assert.equal(bridge.previousSink, 'original-speaker')
  await bridge.setPlaying(true)
  assert.equal(sinks.at(-1), 'original-speaker')
  assert.equal(bridge.silentSink, false)
  await bridge.setPlaying(false)
  assert.deepEqual(sinks.at(-1), { type: 'none' })
  assert.equal(bridge.context.state, 'suspended')
})

test('native transitions retain the original browser sink instead of capturing none', async t => {
  const { bridge } = bridgeFixture(t)
  const sinks = []
  bridge.browserDeviceId = 'selected-speaker'
  bridge.context.sinkId = 'selected-speaker'
  bridge.context.setSinkId = async value => { sinks.push(value); bridge.context.sinkId = value }
  await bridge.configure({ precision: 'float32' })
  assert.deepEqual(sinks, [{ type: 'none' }])
  assert.equal(bridge.previousSink, 'selected-speaker')
  await bridge.configure({ precision: 'pcm16' })
  assert.equal(bridge.previousSink, 'selected-speaker')
  await bridge.configure({ precision: 'auto' })
  assert.equal(sinks.at(-1), 'selected-speaker')
  assert.equal(bridge.silentSink, false)
})

test('pausing during silent-sink selection does not open a late native stream', async t => {
  const { bridge, calls } = bridgeFixture(t)
  let release, entered
  const waiting = new Promise(resolve => { entered = resolve })
  bridge.context.setSinkId = async value => {
    if (value?.type === 'none') {
      entered()
      await new Promise(resolve => { release = resolve })
    }
    bridge.context.sinkId = value
  }
  const starting = bridge.configure({ precision: 'float32' })
  await waiting
  const stopping = bridge.setPlaying(false)
  release()
  await Promise.all([starting, stopping])
  assert.equal(bridge.session, null)
  assert.equal(calls.includes('open'), false)
  assert.equal(bridge.context.sinkId.type, 'none')
  assert.equal(bridge.context.state, 'suspended')
})

test('Auto resumes on the speaker selected while output was idle', async t => {
  const { bridge } = bridgeFixture(t, false)
  const sinks = []
  bridge.context.setSinkId = async value => sinks.push(value)
  await bridge.configure({ precision: 'auto' })
  bridge.browserDeviceId = 'new-speaker'
  await bridge.setPlaying(true)
  assert.equal(sinks.at(-1), 'new-speaker')
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
