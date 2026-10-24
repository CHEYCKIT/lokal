import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadingSession, acceptStreamSignal, startupProgress, withPreparationProgress, streamLoadKey } from '../src/streamStartupProgress.mjs'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const toast = readFileSync(new URL('../src/components/StreamLoadingToast.jsx', import.meta.url), 'utf8')
const store = readFileSync(new URL('../src/store/player.js', import.meta.url), 'utf8')
const backend = readFileSync(new URL('../electron/ipc/online.js', import.meta.url), 'utf8')
const sources = readFileSync(new URL('../electron/online/sources.js', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8')
const recommendations = readFileSync(new URL('../src/recommendations.js', import.meta.url), 'utf8')

test('all startup milestones are observable and progress never pretends to be song download percent', () => {
  const progress = ['preparing', 'searching', 'resolving', 'fetching', 'headers', 'receiving', 'decoding', 'ready'].map(startupProgress)
  assert.deepEqual(progress, [10, 20, 30, 70, 80, 90, 95, 100])
  assert.ok(progress.every(p => p > 0))
  assert.equal(startupProgress('unknown'), null)
  assert.match(toast, /startup.*stages|startup.*milestones|startup/si)
  assert.ok(!toast.includes('bufferedMediaPercent('), 'do not report a fake/zero buffered media percentage')
})

test('provider fallback keeps one generation but increments the source attempt', () => {
  const a = loadingSession(null, { generation: 10, sourceKey: 'a-1111111111:a', phase: 'preparing' })
  assert.equal(a.attempt, 1)
  const pending = loadingSession(a, { generation: 10, sourceKey: '', phase: 'searching', recovering: true, attempt: 2 })
  assert.equal(pending.attempt, 2)
  assert.equal(pending.recovering, true)
  const next = loadingSession(pending, { generation: 10, sourceKey: 'a-2222222222:b', phase: 'preparing', attempt: pending.attempt })
  assert.equal(next.attempt, 2)
  assert.equal(next.generation, a.generation)
  assert.equal(next.sourceKey, 'a-2222222222:b')
  const third = loadingSession(next, { generation: 10, sourceKey: 'sc:c' })
  assert.equal(third.attempt, 3)
  const newSong = loadingSession(third, { generation: 11, sourceKey: 'yt:video' })
  assert.equal(newSong.attempt, 1)
  assert.equal(newSong.generation, 11)
})

test('real protocol events advance each attempt and discard stale sources and regressing range requests', () => {
  const begin = loadingSession(null, { generation: 1, sourceKey: 'a-1234567890:id' })
  const signal = phase => ({ provider: 'a-1234567890', id: 'id', phase })
  const a = acceptStreamSignal(begin, signal('resolving'), 'a-1234567890:id')
  assert.equal(a.phase, 'resolving')
  const b = acceptStreamSignal(a, signal('fetching'), 'a-1234567890:id')
  const c = acceptStreamSignal(b, signal('headers'), 'a-1234567890:id')
  const d = acceptStreamSignal(c, signal('receiving'), 'a-1234567890:id')
  assert.equal(d.phase, 'receiving')
  assert.equal(acceptStreamSignal(d, signal('headers'), 'a-1234567890:id'), null)
  assert.equal(acceptStreamSignal(d, { provider: 'sc', id: 'old', phase: 'receiving' }, 'a-1234567890:id'), null)
  assert.equal(acceptStreamSignal({ ...d, recovering: true }, signal('headers'), 'a-1234567890:id'), null)
  assert.equal(acceptStreamSignal(d, signal('ready'), 'a-1234567890:id'), null)
  assert.equal(acceptStreamSignal(null, signal('receiving'), 'a-1234567890:id'), null)
})

test('stream loader remains mounted through searching and each provider change', () => {
  assert.ok(toast.includes('String(load.generation)'), 'one toast for the playback generation')
  assert.ok(!toast.includes('fallbackRecoveryPending'), 'fallback must not close the loader')
  assert.ok(toast.includes('!load.recovering'), 'loading stays visible during recovery')
  assert.ok(toast.includes('Source ${attempt}'), 'the second/third source is labeled')
  assert.ok(app.includes('recovering: true'), 'recovery is a first class loading state')
  assert.ok(app.includes('loadingSession(prior'), 'failed provider continues the same session')
  assert.ok(app.includes('attempt: (player.streamLoading?.attempt || 2) +'), 'failed source advances attempt number')
  assert.ok(app.includes('onProgress: message =>'), 'source lookup updates progress text')
  assert.ok(!app.includes('const toast = showLoadingToast(reason'), 'recovery cannot own a competing toast')
  assert.ok(store.includes('streamLoading: null'))
  assert.ok(store.includes('setStreamLoading:'))
})

test('provider stream plumbing emits resolve, fetch, headers, bytes and decoder-ready', () => {
  assert.ok(sources.includes("opts.onPhase?.('resolving')"))
  assert.ok(sources.includes("opts.onPhase?.('fetching')"))
  assert.ok(backend.includes("report(res.ok ? 'headers' : 'error'"))
  assert.ok(backend.includes("report('receiving', { loaded"))
  assert.ok(backend.includes("res.ok ? bytes => report('receiving'"), 'startup bytes reported once from existing stream reader')
  assert.ok(sources.includes('if (!reported && value?.byteLength)'), 'one progress event, no per-packet IPC')
  assert.ok(!backend.includes('new TransformStream('), 'do not add another streaming transform or decoding overhead')
  assert.ok(backend.includes('upstream.abort()'), 'preserve source cancellation')
  assert.ok(preload.includes("onStreamStartup: fn => on('online:streamStartup'"))
  assert.ok(toast.includes('acceptStreamSignal(state.streamLoading, signal, key)'))
  assert.ok(app.includes("phase: 'ready'"), 'decoder readiness is an explicit milestone')
  assert.ok(app.includes('setStreamLoading(null); clearPlaybackError()'), 'close on playback start')
})

test('measured Mornye worker percentage advances startup monotonically before streaming', () => {
  let load = loadingSession(null, { generation: 5, sourceKey: 'a-1234567890:song' })
  assert.equal(startupProgress(load.phase, load.addonPercent), 10)
  const measured = []
  for (const pct of [0, 1, 18, 45, 80, 100]) {
    load = withPreparationProgress(load, { progress: pct, message: 'Preparing audio' })
    measured.push(startupProgress(load.phase, load.addonPercent))
  }
  assert.deepEqual(measured, [10, 11, 20, 35, 54, 65])
  assert.equal(load.message, 'Preparing audio')
  assert.equal(startupProgress('fetching'), 70, 'connecting follows completed worker without going backwards')
  assert.equal(startupProgress('headers'), 80)
  assert.equal(startupProgress('receiving'), 90)
  assert.equal(startupProgress('decoding'), 95)
  assert.equal(startupProgress('ready'), 100)
  const retry = loadingSession(load, { generation: 5, sourceKey: 'sc:song', attempt: 2 })
  assert.equal(retry.addonPercent, null, 'a second source never inherits the first source percentage')
  assert.equal(startupProgress(retry.phase, retry.addonPercent), 10)
})

test('invalid worker progress is ignored and status cannot regress within an attempt', () => {
  let load = loadingSession(null, { generation: 2, sourceKey: 'a-1234567890:track' })
  load = withPreparationProgress(load, { progress: 55 })
  assert.equal(load.addonPercent, 55)
  load = withPreparationProgress(load, { progress: 20 })
  assert.equal(load.addonPercent, 55)
  load = withPreparationProgress(load, { progress: NaN, message: 'Resolving' })
  assert.equal(load.addonPercent, 55)
  load = withPreparationProgress(load, { progress: 900 })
  assert.equal(load.addonPercent, 55)
  assert.equal(withPreparationProgress(null, { progress: 90 }), null)
})

test('addon preparation polling and both playback paths forward real progress', () => {
  assert.ok(recommendations.includes('onError = () => {}, onProgress = () => {}'))
  assert.ok(recommendations.includes('signal: controller.signal, onProgress'))
  assert.ok(recommendations.includes('onPreparationProgress?.({ source, candidate, status })'))
  assert.ok(app.includes('onPreparationProgress: ({ source, status }) =>'), 'all fallback providers report worker progress')
  assert.ok(app.includes('withPreparationProgress('), 'primary and fallback statuses advance the state')
  assert.ok(app.includes("status?.message || 'Preparing audio…'"))
  assert.ok(app.includes('addonPercent: null, recovering: true'), 'new fallback sources cannot inherit prior %')
  assert.ok(toast.includes('startupProgress(load.phase, load.addonPercent)'))
})

test('resolver exceptions and terminal exhaustion close the same loading session', () => {
  assert.ok(app.includes('} catch (error) {\n      if (isCurrent()) {'), 'thrown retries must be caught')
  assert.ok(app.includes('setStreamLoading(null)'), 'terminal errors reset source progress')
  assert.ok(app.includes('setIsBuffering(false)'), 'terminal errors cannot leave a spinner indefinitely')
  assert.ok(app.includes('showToast(message)'), 'terminal errors remain visible to the user')
})

test('queue navigation starts a fresh loading session even when playbackGeneration is unchanged', () => {
  const base = {
    playbackGeneration: 4, queueIndex: 1, shuffle: false, shuffleIndex: 0,
    currentTrack: { id: 'a', title: 'Same Song', artist: 'A' },
  }
  const key = streamLoadKey(base)
  assert.equal(key, streamLoadKey({ ...base, currentTrack: { id: 'other-provider', title: 'Same Song', artist: 'A' } }),
    'a provider fallback preserves the logical song session')
  assert.notEqual(key, streamLoadKey({ ...base, queueIndex: 2 }), 'next() changes the queue slot')
  assert.notEqual(key, streamLoadKey({ ...base, currentTrack: { id: 'b', title: 'Different Song', artist: 'A' } }))
  const shuffle = { ...base, shuffle: true, shuffleIndex: 2 }
  assert.notEqual(streamLoadKey(shuffle), streamLoadKey({ ...shuffle, shuffleIndex: 3 }),
    'autoNext through shuffle also gets a fresh session')
  const next = loadingSession(loadingSession(null, { generation: key, sourceKey: 'yt:a', attempt: 4 }), {
    generation: streamLoadKey({ ...base, queueIndex: 2 }), sourceKey: 'yt:b',
  })
  assert.equal(next.attempt, 1)
  assert.equal(streamLoadKey({ ...base, currentTrack: null }), null)
  assert.ok(app.includes('streamLoadKey(loadPlayer)'))
  assert.ok(toast.includes('load.generation !== streamLoadKey(state)'))
})

test('request order suppresses late bytes from older HTTP Range requests', () => {
  const key = 'a-1234567890:track'
  const packet = (request, phase) => ({ request, phase, provider: 'a-1234567890', id: 'track' })
  let load = loadingSession(null, { generation: 'song', sourceKey: key })
  load = acceptStreamSignal(load, packet(14, 'resolving'), key)
  assert.equal(load.request, 14)
  load = acceptStreamSignal(load, packet(14, 'headers'), key)
  assert.equal(load.phase, 'headers')
  load = acceptStreamSignal(load, packet(15, 'resolving'), key)
  assert.equal(load.request, 15, 'newer request advances token without rewinding stage')
  assert.equal(load.phase, 'headers')
  assert.equal(acceptStreamSignal(load, packet(14, 'receiving'), key), null,
    'old request may not advance a new media request')
  load = acceptStreamSignal(load, packet(15, 'receiving'), key)
  assert.equal(load.phase, 'receiving')
  assert.equal(load.request, 15)
  assert.equal(acceptStreamSignal(load, packet(13, 'receiving'), key), null)
  const nextSource = loadingSession(load, { generation: 'song', sourceKey: 'sc:next' })
  assert.equal(nextSource.request, 0, 'source fallback resets the range-request token')
})

test('HTTP connection label is only emitted by actual protocol phases', () => {
  assert.ok(!app.includes("phase: 'fetching'"), 'renderer must not preempt actual URL resolution')
  assert.ok(sources.includes("opts.onPhase?.('resolving')"))
  assert.ok(sources.includes("opts.onPhase?.('fetching')"))
  assert.ok(backend.includes("onPhase: phase => report(phase)"))
})
