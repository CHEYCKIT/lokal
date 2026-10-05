import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

const require = createRequire(import.meta.url)

function extractorFixture(t) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = t.mock.fn(() => child.emit('close', null, 'SIGTERM'))
  const spawn = t.mock.method(require('node:child_process'), 'spawn', () => child)
  delete require.cache[require.resolve('../electron/online/youtube.js')]
  return { child, spawn, youtube: require('../electron/online/youtube.js') }
}

test('a killed native extractor reports its timeout instead of an unavailable or missing recording', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { child, youtube } = extractorFixture(t)
  const request = youtube.resolveStream('j_UhEi3GZOU', { ytdlp: '/fixture/yt-dlp' })
  const rejected = assert.rejects(request, /YouTube audio resolution timed out\. Try again\./)
  t.mock.timers.tick(30000)
  await rejected
  assert.equal(child.kill.mock.callCount(), 1)
})

test('an extractor timeout settles even when killing the process emits no close event', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { child, youtube } = extractorFixture(t)
  child.kill = t.mock.fn(() => false)
  const request = youtube.resolveStream('j_UhEi3GZOU', { ytdlp: '/fixture/yt-dlp' })
  const rejected = assert.rejects(request, /YouTube audio resolution timed out/)
  t.mock.timers.tick(30000)
  await rejected
  assert.equal(child.kill.mock.callCount(), 1)
  child.emit('close', null)
})

test('native extraction uses the exact recording URL and a hidden Windows process', async t => {
  const { child, spawn, youtube } = extractorFixture(t)
  const request = youtube.resolveStream('CjdEqFMuNFU', { ytdlp: '/fixture/yt-dlp', cookieArgs: ['--cookies', '/fixture/cookies.txt'] })
  const [executable, args, options] = spawn.mock.calls[0].arguments
  assert.equal(executable, '/fixture/yt-dlp')
  assert.equal(args.at(-1), 'https://music.youtube.com/watch?v=CjdEqFMuNFU')
  assert.ok(args.includes('--cookies'))
  assert.equal(options.windowsHide, true)
  child.stdout.write(JSON.stringify({ url: 'https://media.example.test/native.webm', ext: 'webm', acodec: 'opus', abr: 140 }))
  child.emit('close', 0)
  const stream = await request
  assert.equal(stream.url, 'https://media.example.test/native.webm')
  assert.equal(stream.mime, 'audio/webm')
})
