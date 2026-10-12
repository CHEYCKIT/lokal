import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { startFakeReceiver, DEFAULT_MEDIA_RECEIVER } from './fakeCastReceiver.mjs'

const require = createRequire(import.meta.url)
const { CastController } = require('../electron/cast/controller.js')

const track = id => ({ id, title: `Song ${id}`, artist: 'Artist', duration: 180 })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, ms = 2000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (check()) return; await wait(10) }
  assert.fail('timed out waiting')
}

function setup(t, { appId = null, device } = {}) {
  const prepared = []
  const media = {
    prepare: async (track, { convert }) => {
      prepared.push({ id: track.id, convert })
      return { trackId: String(track.id), url: `http://pc/${track.id}${convert ? '-converted' : ''}`, mime: 'audio/flac', duration: 180, metadata: { metadataType: 3, title: track.title }, keys: [] }
    },
    release: () => {},
  }
  const server = { start: async () => {}, stop: () => {} }
  const controller = new CastController({ media, server, appId, connect: device.connect })
  t.after(() => controller.disconnect({ stopReceiver: false }))
  return { controller, prepared }
}

const tv = device => ({ id: 'tv1', name: 'Living Room TV', kind: 'tv', host: '127.0.0.1', port: device.port })
const sent = (device, type) => device.log.filter(entry => entry.type === type)

test('connects to Google\'s receiver, loads the playing song where it was, and queues the next three', async t => {
  const device = await startFakeReceiver()
  t.after(() => device.close())
  const { controller } = setup(t, { device })
  const statuses = []
  controller.on('status', status => statuses.push(status))
  const result = await controller.connect(tv(device))
  assert.equal(result.joined, false)
  assert.equal(device.state.app.appId, DEFAULT_MEDIA_RECEIVER)
  await controller.setWindow({ current: track('a'), upcoming: [track('b'), track('c'), track('d'), track('e')], position: 42, play: true, repeat: 'none' })
  const load = sent(device, 'LOAD')[0].data
  assert.equal(load.currentTime, 42)
  assert.equal(load.autoplay, true)
  assert.equal(load.media.contentUrl, 'http://pc/a')
  assert.deepEqual(load.media.customData, { lokal: 1, trackId: 'a' })
  assert.deepEqual(device.state.media.items.map(item => item.media.customData.trackId), ['a', 'b', 'c', 'd'], 'the playing song and three ahead')
  const last = statuses.at(-1)
  assert.equal(last.state, 'connected')
  assert.equal(last.trackId, 'a')
  assert.equal(last.playerState, 'PLAYING')
  assert.equal(last.device.name, 'Living Room TV')
})

test('a skip to a song the TV holds is a jump (no new load); the window then slides', async t => {
  const device = await startFakeReceiver()
  t.after(() => device.close())
  const { controller, prepared } = setup(t, { device })
  await controller.connect(tv(device))
  await controller.setWindow({ current: track('a'), upcoming: [track('b'), track('c'), track('d')], play: true })
  await controller.setWindow({ current: track('b'), upcoming: [track('c'), track('d'), track('e')], play: true })
  assert.equal(sent(device, 'LOAD').length, 1, 'no second load')
  assert.equal(sent(device, 'QUEUE_UPDATE').filter(entry => entry.data.currentItemId != null).length, 1)
  assert.equal(controller.status().trackId, 'b')
  const m = device.state.media
  assert.deepEqual(m.items.slice(m.current).map(item => item.media.customData.trackId), ['b', 'c', 'd', 'e'])
  // Each song was made ready once.
  assert.deepEqual(prepared.map(entry => entry.id), ['a', 'b', 'c', 'd', 'e'])
})

test('the TV moving on by itself is reported; the queue order changing under the playing song is followed', async t => {
  const device = await startFakeReceiver()
  t.after(() => device.close())
  const { controller } = setup(t, { device })
  await controller.connect(tv(device))
  await controller.setWindow({ current: track('a'), upcoming: [track('b'), track('c')], play: true })
  device.advance(181)
  await until(() => controller.status().trackId === 'b')
  // The person reordered the queue: after b now comes x, then c.
  await controller.setWindow({ current: track('b'), upcoming: [track('x'), track('c')], play: true })
  const m = device.state.media
  assert.deepEqual(m.items.slice(m.current).map(item => item.media.customData.trackId), ['b', 'x', 'c'])
  // Repeat one is the TV's to do.
  await controller.setWindow({ current: track('b'), upcoming: [track('x'), track('c')], play: true, repeat: 'one' })
  assert.equal(device.state.media.repeatMode, 'REPEAT_SINGLE')
})

test('play, pause, seek and volume reach the TV; the TV\'s own volume buttons come back', async t => {
  const device = await startFakeReceiver()
  t.after(() => device.close())
  const { controller } = setup(t, { device })
  await controller.connect(tv(device))
  await controller.setWindow({ current: track('a'), upcoming: [], play: true })
  await controller.pause()
  assert.equal(device.state.media.playerState, 'PAUSED')
  await controller.seek(90)
  assert.equal(device.state.media.time, 90)
  await controller.play()
  assert.equal(controller.status().playerState, 'PLAYING')
  await controller.setVolume({ level: 0.3 })
  assert.equal(device.state.volume.level, 0.3)
  device.setVolume({ level: 0.7 })
  await until(() => controller.status().volume.level === 0.7)
})

test('a song the TV refuses is converted and loaded again, once; then it\'s reported', async t => {
  const device = await startFakeReceiver()
  t.after(() => device.close())
  const { controller, prepared } = setup(t, { device })
  const errors = []
  controller.on('trackError', error => errors.push(error))
  await controller.connect(tv(device))
  await controller.setWindow({ current: track('a'), upcoming: [], play: true })
  device.failCurrent()
  await until(() => sent(device, 'LOAD').length === 2)
  assert.equal(sent(device, 'LOAD')[1].data.media.contentUrl, 'http://pc/a-converted')
  assert.ok(prepared.some(entry => entry.id === 'a' && entry.convert))
  device.failCurrent()
  await until(() => errors.length === 1)
  assert.equal(errors[0].trackId, 'a')
})

test('Lokal\'s own receiver is used when it starts; Google\'s when it doesn\'t', async t => {
  const withLokal = await startFakeReceiver({ apps: ['LOKAL001', DEFAULT_MEDIA_RECEIVER] })
  t.after(() => withLokal.close())
  const a = setup(t, { device: withLokal, appId: 'LOKAL001' })
  await a.controller.connect(tv(withLokal))
  assert.equal(withLokal.state.app.appId, 'LOKAL001')
  assert.equal(a.controller.status().receiver, 'lokal')
  const without = await startFakeReceiver()
  t.after(() => without.close())
  const b = setup(t, { device: without, appId: 'LOKAL001' })
  await b.controller.connect(tv(without))
  assert.equal(without.state.app.appId, DEFAULT_MEDIA_RECEIVER)
  assert.equal(b.controller.status().receiver, 'default')
})

test('the app closed on the TV ends the session with where it was; Lokal restarting joins the music still playing', async t => {
  const device = await startFakeReceiver()
  t.after(() => device.close())
  const first = setup(t, { device })
  await first.controller.connect(tv(device))
  await first.controller.setWindow({ current: track('a'), upcoming: [track('b')], play: true, position: 30 })
  // Lokal restarts: a new session finds the music playing and joins it.
  const second = setup(t, { device })
  const joined = await second.controller.connect(tv(device))
  assert.equal(joined.joined, true)
  assert.equal(second.controller.status().trackId, 'a')
  assert.equal(sent(device, 'LAUNCH').length, 1, 'not launched again')
  const ended = new Promise(resolve => second.controller.once('ended', resolve))
  device.stopApp()
  const end = await ended
  assert.equal(end.reason, 'stopped')
  assert.equal(end.last.trackId, 'a')
  assert.equal(end.last.position, 30)
})

test('a dropped connection is picked up again: the TV played on', async t => {
  const device = await startFakeReceiver()
  t.after(() => device.close())
  const { controller } = setup(t, { device })
  await controller.connect(tv(device))
  await controller.setWindow({ current: track('a'), upcoming: [], play: true })
  let ended = false
  controller.on('ended', () => { ended = true })
  const rejoined = new Promise(resolve => controller.once('rejoined', resolve))
  device.dropConnections()
  await rejoined
  assert.equal(controller.status().trackId, 'a')
  assert.equal(ended, false)
  await controller.pause()
  assert.equal(device.state.media.playerState, 'PAUSED')
})
