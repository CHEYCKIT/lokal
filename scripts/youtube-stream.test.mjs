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

test('video extraction uses the regular YouTube watch endpoint', async t => {
  const { calls, youtube } = extractorRuns(t, [{ json: { url: 'https://media.example.test/video.mp4', ext: 'mp4', vcodec: 'avc1.640028', height: 1080 } }])
  const request = youtube.resolveStream('4NRXx6U8ABQ', { ytdlp: '/fixture/yt-dlp', quality: 'video', videoHeight: 1080 })
  await request
  assert.equal(calls[0].args.at(-1), 'https://www.youtube.com/watch?v=4NRXx6U8ABQ')
  assert.match(calls[0].args[calls[0].args.indexOf('-f') + 1], /bestvideo\[height<=1080\]/)
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

// ------------------------------------------------------------ the fast engine (youtubeFast.js)

const FAST_URL = 'https://rr1.googlevideo.example/videoplayback?expire=4102444800&cver=1.20250219.01.00&itag=251&pot=x'
const fastEngine = (impl) => ({ calls: 0, resolveAudio(videoId, options) { this.calls++; return impl(videoId, options) } })
const ytdlpAnswers = (child, url = 'https://rr2.googlevideo.example/ytdlp?expire=4102444800') => setImmediate(() => {
  child.stdout.write(JSON.stringify({ url, ext: 'm4a', acodec: 'mp4a.40.2', abr: 128 }) + '\n')
  child.emit('close', 0)
})

test('audio comes from the fast engine first: no yt-dlp, and none needed', async t => {
  const { spawn, youtube } = extractorFixture(t)
  const fast = fastEngine(async () => ({ url: FAST_URL, headers: {}, mime: 'audio/webm', expiresAt: Date.now() + 3600e3, engine: 'youtubei' }))
  const stream = await youtube.resolveStream('j_UhEi3GZOU', { fast })
  assert.equal(stream.url, FAST_URL)
  assert.equal(fast.calls, 1)
  assert.equal(spawn.mock.callCount(), 0)
  // Cached like any other.
  assert.equal((await youtube.resolveStream('j_UhEi3GZOU', { fast })).url, FAST_URL)
  assert.equal(fast.calls, 1)
})

test('a song the fast engine can\'t play goes to yt-dlp, and stays there for a while', async t => {
  const { child, spawn, youtube } = extractorFixture(t)
  const fast = fastEngine(async () => { throw new Error('YouTube: Sign in to confirm your age') })
  ytdlpAnswers(child)
  const stream = await youtube.resolveStream('j_UhEi3GZOU', { fast, ytdlp: '/fixture/yt-dlp' })
  assert.match(stream.url, /ytdlp/)
  assert.equal(fast.calls, 1)
  assert.equal(spawn.mock.callCount(), 1)
  // Looked up again (expired, or refused): straight to yt-dlp, the fast engine isn't asked again.
  ytdlpAnswers(child)
  await youtube.resolveStream('j_UhEi3GZOU', { fast, ytdlp: '/fixture/yt-dlp', force: true })
  assert.equal(fast.calls, 1)
  // Without yt-dlp, the fast engine's failure is the answer.
  await assert.rejects(youtube.resolveStream('aaaaaaaaaaa', { fast: fastEngine(async () => { throw new Error('nope') }) }), /yt-dlp is not installed/)
})

test('a fast link YouTube refuses sends that song to yt-dlp', async t => {
  const { child, youtube } = extractorFixture(t)
  const fast = fastEngine(async () => ({ url: FAST_URL, headers: {}, mime: 'audio/webm', expiresAt: Date.now() + 3600e3, engine: 'youtubei' }))
  let fetched = 0
  const fetchImpl = async url => { fetched++; return new Response(url.includes('ytdlp') ? 'audio' : null, { status: url.includes('ytdlp') ? 206 : 403 }) }
  ytdlpAnswers(child)
  const { res } = await youtube.fetchStream('j_UhEi3GZOU', { fast, ytdlp: '/fixture/yt-dlp', range: 'bytes=0-', fetchImpl })
  assert.equal(res.status, 206)
  assert.equal(fetched, 2)
  assert.equal(fast.calls, 1, 'the refused fast link was not asked for again')
})

test('an engine without video support leaves music videos to yt-dlp', async t => {
  const { child, spawn, youtube } = extractorFixture(t)
  const fast = fastEngine(async () => { throw new Error('should not be asked') })
  setImmediate(() => { child.stdout.write(JSON.stringify({ url: 'https://v.example/video?expire=4102444800', ext: 'mp4', vcodec: 'avc1', height: 1080 }) + '\n'); child.emit('close', 0) })
  const stream = await youtube.resolveStream('j_UhEi3GZOU', { fast, ytdlp: '/fixture/yt-dlp', quality: 'video' })
  assert.equal(stream.mime, 'video/mp4')
  assert.equal(fast.calls, 0)
  assert.equal(spawn.mock.callCount(), 1)
})

const videoEngine = (audio, video) => ({ audioCalls: 0, videoCalls: [], resolveAudio(videoId, options) { this.audioCalls++; return audio(videoId, options) }, resolveVideo(videoId, options) { this.videoCalls.push(options); return video(videoId, options) } })
const FAST_VIDEO = { url: 'https://rr1.googlevideo.example/videoplayback?expire=4102444800&itag=137', headers: {}, mime: 'video/mp4', format: 'avc1 720p', expiresAt: Date.now() + 3600e3, engine: 'youtubei' }

test('a music video\'s picture comes from the fast engine, at the quality setting\'s height', async t => {
  const { spawn, youtube } = extractorFixture(t)
  const fast = videoEngine(async () => { throw new Error('not audio') }, async () => FAST_VIDEO)
  const stream = await youtube.resolveStream('j_UhEi3GZOU', { fast, quality: 'video', videoHeight: 720 })
  assert.equal(stream.url, FAST_VIDEO.url)
  assert.deepEqual(fast.videoCalls, [{ height: 720 }])
  assert.equal(fast.audioCalls, 0)
  assert.equal(spawn.mock.callCount(), 0)
})

test('a video the fast engine can\'t do goes to yt-dlp without sending its song there too', async t => {
  const { child, spawn, youtube } = extractorFixture(t)
  const fast = videoEngine(async () => ({ url: FAST_URL, headers: {}, mime: 'audio/webm', expiresAt: Date.now() + 3600e3, engine: 'youtubei' }), async () => { throw new Error('YouTube offered no picture for this video.') })
  setImmediate(() => { child.stdout.write(JSON.stringify({ url: 'https://v.example/ytdlp-video?expire=4102444800', ext: 'mp4', vcodec: 'avc1', height: 1080 }) + '\n'); child.emit('close', 0) })
  const video = await youtube.resolveStream('j_UhEi3GZOU', { fast, ytdlp: '/fixture/yt-dlp', quality: 'video' })
  assert.match(video.url, /ytdlp-video/)
  assert.equal(spawn.mock.callCount(), 1)
  const audio = await youtube.resolveStream('j_UhEi3GZOU', { fast, ytdlp: '/fixture/yt-dlp' })
  assert.equal(audio.url, FAST_URL, 'the song still plays through the fast engine')
  assert.equal(spawn.mock.callCount(), 1)
})

test('a caller with the fast engine off (downloads) doesn\'t get a cached fast link', async t => {
  const { child, spawn, youtube } = extractorFixture(t)
  const fast = videoEngine(async () => { throw new Error('not audio') }, async () => FAST_VIDEO)
  await youtube.resolveStream('j_UhEi3GZOU', { fast, quality: 'video', videoHeight: 1080 })
  setImmediate(() => { child.stdout.write(JSON.stringify({ url: 'https://v.example/ytdlp-video?expire=4102444800', ext: 'mp4', vcodec: 'avc1', height: 1080 }) + '\n'); child.emit('close', 0) })
  const stream = await youtube.resolveStream('j_UhEi3GZOU', { fast: null, ytdlp: '/fixture/yt-dlp', quality: 'video', videoHeight: 1080 })
  assert.match(stream.url, /ytdlp-video/)
  assert.equal(spawn.mock.callCount(), 1)
})
