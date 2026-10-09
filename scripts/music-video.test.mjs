import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { findMusicVideo, isMusicVideoFor, baseTitle, artistNames, audioFeatures, alignAudio, videoTimeFor, FPS } = require('../electron/online/musicVideo.js')
const { songAudioFor } = require('../electron/ipc/online.js')

const track = { title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 }
const video = (fields) => ({ videoId: 'abcdefghijk', kind: 'video', official: true, artists: ['The Weeknd'], artist: 'The Weeknd', duration: 263, ...fields })

test('titles match without video tags and features', () => {
  assert.equal(baseTitle('Blinding Lights (Official Video)'), 'blinding lights')
  assert.equal(baseTitle('Levitating (feat. DaBaby) [4K]'), 'levitating')
  assert.deepEqual(artistNames('Dua Lipa feat. DaBaby & Elton John'), ['dua lipa', 'dababy', 'elton john'])
  assert.deepEqual(artistNames('TaylorSwiftVEVO'), ['taylorswift'])
})

test('only the official video of the same song by the same artist is a match', () => {
  assert.ok(isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)' })))
  assert.ok(isMusicVideoFor(track, video({ title: 'The Weeknd - Blinding Lights (Official Music Video)' })))
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', official: false })), 'not an official upload')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', artists: ['The Sevenights'], artist: 'The Sevenights' })), 'other artist')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Live at SoFi Stadium)' })), 'live')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Lyric Video)' })), 'lyric video')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Remix)' })), 'remix')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Save Your Tears (Official Video)' })), 'other song')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', kind: 'song' })), 'the song itself')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', duration: 120 })), 'shorter than the song')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', duration: 900 })), 'far longer')
  assert.ok(isMusicVideoFor({ ...track, title: 'Blinding Lights - Live' }, video({ title: 'Blinding Lights (Live)' })), 'the song is the live one')
})

// A deterministic "song": noise bursts at irregular onsets.
function song(seconds, seed = 1) {
  const rate = 8000
  const out = new Float32Array(seconds * rate)
  let x = seed
  const random = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648)
  let t = 0
  while (t < out.length) {
    const length = Math.floor(rate * (0.05 + random() * 0.1))
    const level = 0.2 + random() * 0.8
    for (let i = t; i < Math.min(out.length, t + length); i++) out[i] = (random() * 2 - 1) * level * (1 - (i - t) / length)
    t += length + Math.floor(rate * (0.1 + random() * 0.5))
  }
  return out
}

test('finds where the song starts inside a video with an intro', () => {
  const audio = song(90)
  const intro = new Float32Array(8000 * 20).map((_, i) => Math.sin(i / 3) * 0.05) // 20 s of a quiet hum
  const clip = new Float32Array(intro.length + audio.length)
  clip.set(intro)
  clip.set(audio, intro.length)
  const segments = alignAudio(audioFeatures(audio), audioFeatures(clip))
  assert.ok(segments)
  assert.equal(segments.length, 1)
  assert.ok(Math.abs(segments[0].offset - 20) < 1 / FPS, `offset ${segments[0].offset}`)
  assert.ok(Math.abs(videoTimeFor(segments, 30) - 50) < 0.05)
})

test('follows a skit in the middle of the video', () => {
  const audio = song(120, 7)
  const half = 8000 * 60
  const skit = song(15, 99).map(v => v * 0.3)
  const clip = new Float32Array(audio.length + skit.length)
  clip.set(audio.subarray(0, half))
  clip.set(skit, half)
  clip.set(audio.subarray(half), half + skit.length)
  const segments = alignAudio(audioFeatures(audio), audioFeatures(clip))
  assert.ok(segments && segments.length === 2, JSON.stringify(segments))
  assert.ok(Math.abs(videoTimeFor(segments, 10) - 10) < 0.05)
  assert.ok(Math.abs(videoTimeFor(segments, 100) - 115) < 0.05)
})

test('rejects a video whose audio is another song', () => {
  assert.equal(alignAudio(audioFeatures(song(90, 3)), audioFeatures(song(100, 4))), null)
})

test('does not cache a missing video when audio checking was inconclusive', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-music-video-'))
  const cacheFile = path.join(directory, 'music-videos.json')
  const track = { id: 'online-track', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 }
  const result = {
    contents: [{ musicResponsiveListItemRenderer: {
      navigationEndpoint: { watchEndpoint: { videoId: 'abcdefghijk', watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_OMV' } } } },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Blinding Lights (Official Video)' }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [
          { text: 'The Weeknd', navigationEndpoint: { browseEndpoint: { browseId: 'UC1234567890', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' } } } } },
          { text: ' • ' }, { text: '3:40' },
        ] } } },
      ],
    } }],
  }
  let searches = 0
  const fetchImpl = async url => String(url).endsWith('/')
    ? { ok: true, text: async () => '' }
    : { ok: true, json: async () => { searches++; return result } }
  const options = {
    ffmpeg: '/definitely/missing/ffmpeg',
    songAudio: async () => ({ input: 'song', headers: {} }),
    videoAudio: async () => ({ input: 'video', headers: {} }),
    fetchImpl,
    cacheFile,
  }
  try {
    assert.equal(await findMusicVideo(track, options), null)
    assert.equal(fs.existsSync(cacheFile), false)
    assert.equal(await findMusicVideo(track, options), null)
    assert.equal(searches, 2)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

for (const track of [
  { file_path: 'ghost://soundcloud/online/123' },
  { file_path: 'ghost://addon/0123456789/track%2Fone' },
]) {
  test(`full music-video matching resolves ${track.file_path.split('://')[1].split('/')[0]} audio through sources.resolveStream`, async () => {
    const calls = []
    const getAudio = songAudioFor(track, true, {
      options: { db: 'db', ytdlp: '/fixture/yt-dlp' },
      resolve: async (provider, id, options) => {
        calls.push({ provider, id, options })
        return { url: `https://media.example.test/${provider}/${encodeURIComponent(id)}`, headers: { Authorization: 'test' } }
      },
    })
    assert.ok(getAudio)
    assert.deepEqual(await getAudio(0), {
      input: `https://media.example.test/${track.file_path.startsWith('ghost://soundcloud') ? 'sc/123' : 'a-0123456789/track%2Fone'}`,
      headers: { Authorization: 'test' },
    })
    assert.deepEqual(await getAudio(1), {
      input: `https://media.example.test/${track.file_path.startsWith('ghost://soundcloud') ? 'sc/123' : 'a-0123456789/track%2Fone'}`,
      headers: { Authorization: 'test' },
    })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].options.force, false)
    assert.equal(calls[1].options.force, true)
  })
}
