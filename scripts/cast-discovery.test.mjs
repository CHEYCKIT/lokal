import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { CastDiscovery, kindOf, probeAddress, SERVICE } = require('../electron/cast/discovery.js')

const txt = pairs => ({ type: 'TXT', data: Object.entries(pairs).map(([k, v]) => Buffer.from(`${k}=${v}`)) })
function announce(instance, { host = '192.168.1.40', target = 'abc.local', port = 8009, ...pairs }) {
  return {
    answers: [{ type: 'PTR', name: SERVICE, data: instance }],
    additionals: [
      { type: 'SRV', name: instance, data: { target, port } },
      { ...txt(pairs), name: instance },
      { type: 'A', name: target, data: host },
    ],
  }
}

function pretendMdns() {
  const mdns = new EventEmitter()
  mdns.queries = []
  mdns.query = q => mdns.queries.push(q)
  mdns.destroy = () => {}
  return mdns
}

test('a Google TV, a speaker and a speaker group are found, with their kind; a device without sound is left out', () => {
  const mdns = pretendMdns()
  let now = 1000
  const discovery = new CastDiscovery({ mdns: () => mdns, now: () => now })
  const changes = []
  discovery.on('change', list => changes.push(list))
  discovery.start()
  assert.equal(mdns.queries[0].questions[0].name, SERVICE)
  mdns.emit('response', announce('Chromecast-1._googlecast._tcp.local', { id: 'tv1', fn: 'Living Room TV', md: 'Chromecast', ca: '201221' }))
  mdns.emit('response', announce('Nest-1._googlecast._tcp.local', { host: '192.168.1.41', target: 'n.local', id: 'sp1', fn: 'Kitchen', md: 'Google Nest Mini', ca: '199172' }))
  mdns.emit('response', announce('Group-1._googlecast._tcp.local', { host: '192.168.1.41', target: 'n.local', port: 32187, id: 'g1', fn: 'Downstairs', md: 'Google Cast Group', ca: '199204' }))
  mdns.emit('response', announce('Cam-1._googlecast._tcp.local', { host: '192.168.1.42', target: 'c.local', id: 'cam', fn: 'Doorbell', md: 'Cam', ca: '2' }))
  const list = discovery.list()
  assert.deepEqual(list.map(d => [d.name, d.kind, d.host, d.port]), [
    ['Living Room TV', 'tv', '192.168.1.40', 8009],
    ['Kitchen', 'speaker', '192.168.1.41', 8009],
    ['Downstairs', 'group', '192.168.1.41', 32187],
  ])
  assert.equal(changes.length, 3)
  // The same announcement again isn't news.
  mdns.emit('response', announce('Chromecast-1._googlecast._tcp.local', { id: 'tv1', fn: 'Living Room TV', md: 'Chromecast', ca: '201221' }))
  assert.equal(changes.length, 3)
  // Gone quiet for long enough: forgotten.
  now += 5 * 60 * 1000
  discovery.expire()
  assert.equal(discovery.list().length, 0)
  discovery.stop()
})

test('half an answer (no TXT yet) asks for the rest, and the device appears once it comes', () => {
  const mdns = pretendMdns()
  const discovery = new CastDiscovery({ mdns: () => mdns })
  discovery.start()
  mdns.emit('response', { answers: [{ type: 'PTR', name: SERVICE, data: 'X._googlecast._tcp.local' }], additionals: [] })
  assert.ok(mdns.queries.some(q => q.questions.some(question => question.name === 'X._googlecast._tcp.local' && question.type === 'TXT')))
  mdns.emit('response', announce('X._googlecast._tcp.local', { id: 'x', fn: 'Bedroom TV', ca: '5' }))
  assert.equal(discovery.list()[0].name, 'Bedroom TV')
  discovery.stop()
})

test('mDNS that can\'t start finds nothing instead of throwing', () => {
  const discovery = new CastDiscovery({ mdns: () => { throw new Error('EADDRINUSE') } })
  assert.doesNotThrow(() => discovery.scan())
  assert.deepEqual(discovery.list(), [])
})

test('kinds, and a device added by its address takes its name from the device', async () => {
  assert.equal(kindOf({ ca: '4', md: 'Google Home' }), 'speaker')
  assert.equal(kindOf({ ca: '5', md: 'Chromecast' }), 'tv')
  const device = await probeAddress('192.168.1.50', { fetchImpl: async url => ({ json: async () => (assert.match(url, /192\.168\.1\.50:8008\/setup\/eureka_info/), { name: 'Den TV', device_info: { model_name: 'Google TV Streamer' } }) }) })
  assert.deepEqual(device, { id: 'ip:192.168.1.50', name: 'Den TV', model: 'Google TV Streamer', host: '192.168.1.50', port: 8009, kind: 'tv' })
  const unnamed = await probeAddress('192.168.1.51', { fetchImpl: async () => { throw new Error('no') } })
  assert.equal(unnamed.name, '192.168.1.51')
  await assert.rejects(probeAddress('living room'), /IP address/)
})
