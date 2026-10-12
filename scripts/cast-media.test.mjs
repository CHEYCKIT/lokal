import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { planFile, targetRate, convertArgs, family } = require('../electron/cast/formats.js')
const { createCastMediaServer, localAddressFor, parseRange } = require('../electron/cast/mediaServer.js')
const { createCastMedia } = require('../electron/cast/media.js')

test('what goes to the TV as it is, and what is converted (and to what)', () => {
  const direct = info => planFile(info).action
  assert.equal(direct({ file: 'a.flac', codec: 'FLAC', sampleRate: 96000, bitDepth: 24 }), 'direct')
  assert.equal(direct({ file: 'a.mp3', codec: 'MPEG 1 Layer 3', sampleRate: 44100 }), 'direct')
  assert.equal(direct({ file: 'a.m4a', codec: 'MPEG-4/AAC', sampleRate: 44100 }), 'direct')
  assert.equal(direct({ file: 'a.opus', codec: 'Opus', sampleRate: 48000 }), 'direct')
  assert.equal(direct({ file: 'a.wav', codec: 'PCM', sampleRate: 44100, bitDepth: 16 }), 'direct')
  // Hi-res beyond the TV comes down within the same rate family, 24-bit kept.
  assert.deepEqual(planFile({ file: 'a.flac', codec: 'FLAC', sampleRate: 192000, bitDepth: 24 }), { action: 'convert', to: 'flac', ext: '.flac', mime: 'audio/flac', rate: 96000, depth: 24 })
  assert.equal(planFile({ file: 'a.flac', codec: 'FLAC', sampleRate: 176400, bitDepth: 24 }).rate, 88200)
  assert.equal(planFile({ file: 'a.dsf', codec: 'DSD', sampleRate: 2822400, bitDepth: 1, lossless: 1 }).rate, 88200)
  // ALAC (in .m4a) and AIFF are lossless the TV can't read: FLAC, rate kept.
  assert.deepEqual(planFile({ file: 'a.m4a', codec: 'ALAC', sampleRate: 44100, bitDepth: 16, lossless: 1 }), { action: 'convert', to: 'flac', ext: '.flac', mime: 'audio/flac', rate: 44100, depth: 16 })
  assert.equal(planFile({ file: 'a.aiff', codec: 'PCM', sampleRate: 48000, bitDepth: 24, lossless: 1 }).to, 'flac')
  // Lossy it can't read: AAC.
  assert.equal(planFile({ file: 'a.wma', codec: 'Windows Media Audio', sampleRate: 44100, lossless: 0 }).to, 'aac')
  // "Standard" quality (a weak Wi-Fi): 16/48 at most.
  assert.deepEqual(planFile({ file: 'a.flac', codec: 'FLAC', sampleRate: 96000, bitDepth: 24 }, 'standard'), { action: 'convert', to: 'flac', ext: '.flac', mime: 'audio/flac', rate: 48000, depth: 16 })
  assert.equal(planFile({ file: 'a.flac', codec: 'FLAC', sampleRate: 44100, bitDepth: 16 }, 'standard').action, 'direct')
  assert.equal(targetRate(48000, { rate: 96000 }), 48000)
  assert.equal(family('Vorbis I'), 'vorbis')
  const args = convertArgs('in.m4a', 'out.flac', { to: 'flac', rate: 96000, depth: 24 })
  assert.deepEqual(args.slice(args.indexOf('-ar'), args.indexOf('-ar') + 2), ['-ar', '96000'])
  assert.ok(args.includes('s32') && args.at(-1) === 'out.flac')
})

test('this computer\'s address on the TV\'s network, and ranges', () => {
  const interfaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0' }],
    vpn: [{ address: '10.8.0.2', family: 'IPv4', internal: false, netmask: '255.255.255.0' }],
    wifi: [{ address: '192.168.1.23', family: 'IPv4', internal: false, netmask: '255.255.255.0' }],
  }
  assert.equal(localAddressFor('192.168.1.40', interfaces), '192.168.1.23')
  assert.equal(localAddressFor('172.20.0.9', interfaces), '10.8.0.2')
  assert.deepEqual(parseRange('bytes=100-', 1000), { start: 100, end: 999 })
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 })
  assert.equal(parseRange('bytes=2000-', 1000), 'bad')
  assert.equal(parseRange(null, 1000), null)
})

test('the TV fetches a song (and seeks in it), only by its token and key; online songs are relayed', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-cast-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const song = path.join(dir, 'song.mp3')
  fs.writeFileSync(song, Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256)))
  const server = createCastMediaServer()
  await server.start()
  t.after(() => server.stop())
  const relayed = []
  const media = createCastMedia({
    server,
    trackRow: id => (id === 'local' ? { id, file_path: song, codec: 'MPEG 1 Layer 3', duration: 200, title: 'Song', artist: 'Artist', album: 'Album' } : null),
    streamRef: row => (row.id === 'yt' ? { provider: 'yt', id: 'abcdefghijk' } : null),
    resolveStream: async () => ({ url: 'https://example.invalid/x', mime: 'audio/webm; codecs="opus"' }),
    fetchStream: async (provider, id, { range }) => { relayed.push(range); return { res: new Response('opus-bytes', { status: 206, headers: { 'content-range': 'bytes 0-9/10', 'content-length': '10' } }), mime: 'audio/webm' } },
  })
  const prepared = await media.prepare({ id: 'local' }, { deviceHost: '127.0.0.1' })
  assert.equal(prepared.mime, 'audio/mpeg')
  assert.deepEqual(prepared.metadata, { metadataType: 3, title: 'Song', artist: 'Artist', albumName: 'Album' })
  const local = prepared.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${server.port}`)
  const whole = await fetch(local)
  assert.equal(whole.status, 200)
  assert.equal((await whole.arrayBuffer()).byteLength, 5000)
  const part = await fetch(local, { headers: { Range: 'bytes=1000-1009' } })
  assert.equal(part.status, 206)
  assert.equal(part.headers.get('content-range'), 'bytes 1000-1009/5000')
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], Array.from({ length: 10 }, (_, i) => (1000 + i) % 256))
  // Wrong token or unknown key: nothing.
  assert.equal((await fetch(local.replace(/\/[0-9a-f]{32}\//, `/${'0'.repeat(32)}/`))).status, 404)
  // Taken down after use.
  media.release(prepared)
  assert.equal((await fetch(local)).status, 404)
  // An online song: relayed, typed for the TV.
  const online = await media.prepare({ id: 'yt', title: 'Online' }, { deviceHost: '127.0.0.1' })
  assert.equal(online.mime, 'audio/webm')
  const res = await fetch(online.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${server.port}`), { headers: { Range: 'bytes=0-' } })
  assert.equal(res.status, 206)
  assert.equal(await res.text(), 'opus-bytes')
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.deepEqual(relayed, ['bytes=0-'])
})

test('a file the TV can\'t play is converted once (the second time comes from the cache)', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-cast-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const song = path.join(dir, 'song.m4a')
  fs.writeFileSync(song, 'alac')
  const server = createCastMediaServer()
  await server.start()
  t.after(() => server.stop())
  const runs = []
  const media = createCastMedia({
    server,
    cacheDir: () => path.join(dir, 'cache'),
    trackRow: id => ({ id, file_path: song, codec: 'ALAC', sample_rate: 44100, bit_depth: 16, lossless: 1 }),
    convert: async (ffmpeg, args) => { runs.push(args); fs.writeFileSync(args.at(-1), 'flac-bytes') },
  })
  const first = await media.prepare({ id: 'a' }, { deviceHost: '127.0.0.1' })
  const second = await media.prepare({ id: 'a' }, { deviceHost: '127.0.0.1' })
  assert.equal(first.mime, 'audio/flac')
  assert.equal(first.converted, true)
  assert.equal(runs.length, 1)
  assert.ok(runs[0].includes('flac'))
  const res = await fetch(second.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${server.port}`))
  assert.equal(await res.text(), 'flac-bytes')
})

test('converted songs the TV still holds are kept when the cache is trimmed', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-cast-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const songs = ['a', 'b'].map(name => { const file = path.join(dir, `${name}.m4a`); fs.writeFileSync(file, name); return file })
  const server = createCastMediaServer()
  await server.start()
  t.after(() => server.stop())
  const trims = []
  const media = createCastMedia({
    server,
    cacheDir: () => path.join(dir, 'cache'),
    trackRow: id => ({ id, file_path: songs[id === 'a' ? 0 : 1], codec: 'ALAC', sample_rate: 44100, bit_depth: 16, lossless: 1 }),
    convert: async (ffmpeg, args) => { fs.writeFileSync(args.at(-1), 'flac') },
    trimCache: keep => trims.push(keep),
  })
  const first = await media.prepare({ id: 'a' }, { deviceHost: '127.0.0.1' })
  await media.prepare({ id: 'b' }, { deviceHost: '127.0.0.1' })
  assert.ok(trims[1].includes(first.files[0]), 'the first song, still held, is kept')
  media.release(first)
  fs.rmSync(path.join(dir, 'cache'), { recursive: true, force: true })
  await media.prepare({ id: 'b' }, { deviceHost: '127.0.0.1' })
  assert.ok(!trims.at(-1).includes(first.files[0]), 'released: no longer kept')
})
