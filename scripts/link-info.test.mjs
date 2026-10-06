import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { linkInfo, parseYtdlp, _clear } = require('../electron/download/linkInfo.js')

const json = body => ({ ok: true, json: async () => body })
const notFound = { ok: false, json: async () => null }

// A stand-in for yt-dlp that prints `out` and exits.
function fakeSpawn(out, calls = []) {
  return (bin, args) => {
    calls.push(args)
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = () => {}
    setImmediate(() => { proc.stdout.emit('data', Buffer.from(out)); proc.emit('close', 0) })
    return proc
  }
}

test('a YouTube playlist: its name, owner and a cover without black bars, from oEmbed', async () => {
  _clear()
  const asked = []
  const info = await linkInfo('https://youtube.com/playlist?list=PLabc&si=x', {
    fetchImpl: async url => { asked.push(url); return json({ title: 'Road Trip', author_name: 'Some Person', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }) },
  })
  assert.equal(new URL(asked[0]).origin, 'https://www.youtube.com')
  assert.equal(new URL(asked[0]).searchParams.get('url'), 'https://youtube.com/playlist?list=PLabc&si=x')
  assert.deepEqual(info, { ok: true, title: 'Road Trip', author: 'Some Person', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg' })
})

test('a SoundCloud song: "Title by Artist" becomes the title alone', async () => {
  _clear()
  const info = await linkInfo('https://soundcloud.com/forss/flickermood', {
    fetchImpl: async url => {
      assert.equal(new URL(url).origin, 'https://soundcloud.com')
      return json({ title: 'Flickermood by Forss', author_name: 'Forss', thumbnail_url: 'https://i1.sndcdn.com/artworks-x-t500x500.jpg' })
    },
  })
  assert.deepEqual(info, { ok: true, title: 'Flickermood', author: 'Forss', thumbnail: 'https://i1.sndcdn.com/artworks-x-t500x500.jpg' })
})

test('a playlist oEmbed can\'t see (private, unlisted) is read with yt-dlp and the cookies from Settings', async () => {
  _clear()
  const calls = []
  const out = JSON.stringify({ title: 'Private Mix', uploader: 'Me', playlist_count: 4600, entries: [{ thumbnails: [{ url: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg', width: 480, height: 360 }] }] })
  const info = await linkInfo('https://www.youtube.com/playlist?list=PLprivate', {
    ytdlp: '/bin/yt-dlp', settings: {}, fetchImpl: async () => notFound, spawnImpl: fakeSpawn(out, calls),
  })
  assert.deepEqual(info, { ok: true, title: 'Private Mix', author: 'Me', thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg', count: 4600 })
  assert.ok(calls[0].includes('--flat-playlist') && calls[0].includes('--playlist-items'))
  assert.equal(calls[0].at(-1), 'https://www.youtube.com/playlist?list=PLprivate')
})

test('other sites (Bandcamp) go straight to yt-dlp; nothing is fetched from the pasted link itself', async () => {
  _clear()
  let fetched = false
  const info = await linkInfo('https://artist.bandcamp.com/album/record', {
    ytdlp: '/bin/yt-dlp', fetchImpl: async () => { fetched = true; return notFound },
    spawnImpl: fakeSpawn(JSON.stringify({ title: 'Record', uploader: 'Artist', thumbnail: 'https://f4.bcbits.com/img/a1_10.jpg' })),
  })
  assert.equal(fetched, false)
  assert.equal(info.title, 'Record')
  assert.equal(info.thumbnail, 'https://f4.bcbits.com/img/a1_10.jpg')
})

test('answers are kept; failures are asked again', async () => {
  _clear()
  let calls = 0
  const fetchImpl = async () => { calls++; return calls === 1 ? notFound : json({ title: 'Song', author_name: 'Artist' }) }
  assert.ok((await linkInfo('https://youtu.be/dQw4w9WgXcQ', { fetchImpl })).error)
  assert.equal((await linkInfo('https://youtu.be/dQw4w9WgXcQ', { fetchImpl })).title, 'Song')
  assert.equal((await linkInfo('https://youtu.be/dQw4w9WgXcQ', { fetchImpl })).title, 'Song')
  assert.equal(calls, 2)
})

test('not a link, or no usable answer', async () => {
  _clear()
  assert.ok((await linkInfo('not a link')).error)
  assert.ok((await linkInfo('ftp://example.com/x')).error)
  assert.equal(parseYtdlp('not json'), null)
  assert.equal(parseYtdlp(JSON.stringify({ entries: [] })), null)
  // Only https covers are passed on.
  assert.equal(parseYtdlp(JSON.stringify({ title: 'T', thumbnail: 'http://example.com/a.jpg' })).thumbnail, null)
})
