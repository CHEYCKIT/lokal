import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { hlsPieces, joinHls } = require('../electron/online/soundcloud.js')

test('resolves relative HLS init and segment URLs', () => {
  const parsed = hlsPieces('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:10,\na/one.m4s\n#EXTINF:10,\n../two.m4s\n#EXT-X-ENDLIST', 'https://cdn.example.test/audio/list.m3u8')
  assert.equal(parsed.init, 'https://cdn.example.test/audio/init.mp4')
  assert.deepEqual(parsed.media, [
    'https://cdn.example.test/audio/a/one.m4s',
    'https://cdn.example.test/two.m4s',
  ])
})

test('rejects encrypted and master playlists instead of silently corrupting their audio', () => {
  assert.throws(() => hlsPieces('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nlow.m3u8', 'https://cdn.example.test/a.m3u8'), /master playlist/)
  assert.throws(() => hlsPieces('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\nseg.ts', 'https://cdn.example.test/a.m3u8'), /encrypted/)
})

test('joins the init fragment and media segments in playlist order', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-sc-hls-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'song.m4a')
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    if (url === 'https://cdn.example.test/list.m3u8') {
      return new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\none.m4s\n#EXTINF:1,\ntwo.m4s\n#EXT-X-ENDLIST', { status: 200 })
    }
    const payload = url.endsWith('init.mp4') ? 'INIT' : url.endsWith('one.m4s') ? 'ONE' : 'TWO'
    return new Response(payload, { status: 200 })
  }
  await joinHls('https://cdn.example.test/list.m3u8', file, { fetchImpl })
  assert.equal(fs.readFileSync(file, 'utf8'), 'INITONETWO')
  assert.equal(calls.length, 4)
})
