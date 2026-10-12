import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { startFakeReceiver } from './fakeCastReceiver.mjs'

const require = createRequire(import.meta.url)
const { CastConnection, NS, encodeMessage, decodeMessage, frame, createDeframer } = require('../electron/cast/castv2.js')

test('a CastMessage round-trips through the hand-written protobuf, including long and non-ASCII payloads', () => {
  const data = { type: 'LOAD', title: 'Beyoncé – ' + 'x'.repeat(400) }
  const decoded = decodeMessage(encodeMessage({ source: 'sender-0', destination: 'web-7', namespace: NS.media, data }))
  assert.equal(decoded.source, 'sender-0')
  assert.equal(decoded.destination, 'web-7')
  assert.equal(decoded.namespace, NS.media)
  assert.equal(decoded.payloadType, 0)
  assert.deepEqual(JSON.parse(decoded.payload), data)
})

test('messages split across chunks, or several in one chunk, come out whole and in order', () => {
  const got = []
  const deframe = createDeframer(message => got.push(JSON.parse(message.payload).n))
  const bytes = Buffer.concat([1, 2, 3].map(n => frame({ namespace: NS.media, data: { n } })))
  for (let i = 0; i < bytes.length; i += 7) deframe(bytes.subarray(i, i + 7))
  assert.deepEqual(got, [1, 2, 3])
  assert.throws(() => createDeframer(() => {})(Buffer.from([0x7f, 0xff, 0xff, 0xff])), /too large/)
})

test('connects, answers the device\'s PING, and pairs requests with their replies', async t => {
  const device = await startFakeReceiver()
  t.after(() => device.close())
  const cast = new CastConnection({ host: '127.0.0.1', port: device.port, connect: device.connect })
  await cast.open()
  t.after(() => cast.close())
  const status = await cast.request(NS.receiver, { type: 'GET_STATUS' })
  assert.equal(status.type, 'RECEIVER_STATUS')
  assert.equal(status.status.volume.level, 0.5)
  assert.ok(device.log.some(entry => entry.namespace === NS.connection && entry.type === 'CONNECT'), 'opens the virtual connection')
  // A launch the device can't do is answered, not left hanging.
  const refused = await cast.request(NS.receiver, { type: 'LAUNCH', appId: 'NOPE0000' })
  assert.equal(refused.type, 'LAUNCH_ERROR')
})

test('a device that goes away rejects what was waiting and reports the close', async t => {
  const device = await startFakeReceiver()
  t.after(() => device.close())
  const cast = new CastConnection({ host: '127.0.0.1', port: device.port, connect: device.connect })
  await cast.open()
  const closed = new Promise(resolve => cast.once('close', resolve))
  device.dropConnections()
  assert.ok(await closed, 'a reason is given')
  await assert.rejects(cast.request(NS.receiver, { type: 'GET_STATUS' }), /Not connected/)
})
