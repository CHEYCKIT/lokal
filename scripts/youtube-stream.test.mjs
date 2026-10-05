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

// One fake yt-dlp process per spawn, answered in order.
function extractorRuns(t, answers) {
  const calls = []
  t.mock.method(require('node:child_process'), 'spawn', (executable, args, options) => {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => {}
    calls.push({ args, options })
    const answer = answers.shift()
    setImmediate(() => {
      if (answer.json) child.stdout.write(JSON.stringify(answer.json))
      if (answer.stderr) child.stderr.write(answer.stderr)
      setImmediate(() => child.emit('close', answer.json ? 0 : 1))
    })
    return child
  })
  delete require.cache[require.resolve('../electron/online/jsRuntime.js')]
  delete require.cache[require.resolve('../electron/online/youtube.js')]
  return { calls, youtube: require('../electron/online/youtube.js') }
}

const AUDIO = { url: 'https://media.example.test/audio.webm', ext: 'webm', acodec: 'opus', abr: 130 }
const NO_FORMAT = 'ERROR: [youtube] j_UhEi3GZOU: Requested format is not available. Use --list-formats for a list of available formats\n'

test('yt-dlp is given this process as its JavaScript runtime, which signed-in YouTube clients need', async t => {
  const { calls, youtube } = extractorRuns(t, [{ json: AUDIO }])
  await youtube.resolveStream('j_UhEi3GZOU', { ytdlp: '/fixture/yt-dlp', cookieArgs: ['--cookies', '/fixture/cookies.txt'] })
  const at = calls[0].args.indexOf('--js-runtimes')
  assert.ok(at >= 0)
  assert.equal(calls[0].args[at + 1], `node:${process.execPath}`)
  assert.equal(calls[0].options.windowsHide, true)
})

test('a signed-in song with no usable format plays signed out instead of being reported unavailable', async t => {
  const { calls, youtube } = extractorRuns(t, [{ stderr: NO_FORMAT }, { json: AUDIO }])
  const stream = await youtube.resolveStream('CjdEqFMuNFU', { ytdlp: '/fixture/yt-dlp', cookieArgs: ['--cookies', '/fixture/cookies.txt'] })
  assert.equal(stream.url, AUDIO.url)
  assert.equal(calls.length, 2)
  assert.ok(calls[0].args.includes('--cookies'))
  assert.ok(!calls[1].args.includes('--cookies'))
})

test('a missing format is not reported as the song missing from YouTube', async t => {
  const { calls, youtube } = extractorRuns(t, [{ stderr: NO_FORMAT }])
  await assert.rejects(youtube.resolveStream('dLl4PZtxia8', { ytdlp: '/fixture/yt-dlp' }), error => {
    assert.doesNotMatch(error.message, /not available on YouTube/)
    assert.match(error.message, /no playable audio/)
    return true
  })
  assert.equal(calls.length, 1) // signed out already: nothing else to try
  assert.equal(youtube.streamError('ERROR: [youtube] x: Video unavailable'), 'This song is not available on YouTube.')
})

test('a yt-dlp too old for --js-runtimes is run again without it, and not given it again', async t => {
  const { calls, youtube } = extractorRuns(t, [
    { stderr: 'Usage: yt-dlp [OPTIONS] URL [URL...]\n\nyt-dlp: error: no such option: --js-runtimes\n' },
    { json: AUDIO },
    { json: AUDIO },
  ])
  const stream = await youtube.resolveStream('fJ9rUzIMcZQ', { ytdlp: '/fixture/yt-dlp' })
  assert.equal(stream.url, AUDIO.url)
  await youtube.resolveStream('04854XqcfCY', { ytdlp: '/fixture/yt-dlp' })
  assert.deepEqual(calls.map(call => call.args.includes('--js-runtimes')), [true, false, false])
})
