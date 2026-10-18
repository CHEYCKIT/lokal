import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const source = readFileSync(new URL('../addons/yandex-music/index.js', import.meta.url), 'utf8')

/** Builds a mocked provider runtime for offline regression tests. */
function createProvider({ token = 'test-token', routes = {}, files = {} } = {}) {
  let extension
  const requests = []
  const fileCalls = []
  const cryptoCalls = []
  const decryptCalls = []
  const context = {
    settings: { token },
    registerExtension(value) { extension = value },
    http: {
      get(url, headers) {
        requests.push({ url: String(url), headers: { ...headers } })
        const handler = Object.entries(routes).find(([pattern]) => new RegExp(pattern).test(String(url)))?.[1]
        if (typeof handler === 'function') return handler(String(url), headers)
        return { statusCode: 200, body: JSON.stringify(handler ?? { result: {} }) }
      }
    },
    utils: {
      hmacSHA256Base64(message, key) { cryptoCalls.push({ message, key }); return 'signature==' },
      isDownloadCancelled() { return false },
      decryptBlockCipher(data, options) {
        decryptCalls.push({ length: data.byteLength || data.length, iv: Array.from(options.iv || []), key: options.key, algorithm: options.algorithm, mode: options.mode })
        if (files.failDecryptAt && decryptCalls.length === files.failDecryptAt) return { success: false, error: 'simulated decryption failure' }
        return { success: true, data: data, options }
      }
    },
    file: {
      download(url, dest, options) { fileCalls.push({ type: 'download', url, dest }); return { success: true, path: dest } },
      delete(path) { fileCalls.push({ type: 'delete', path }); return { success: true } },
      getSize(path) { return files.size !== undefined ? (typeof files.size === 'number' ? { success: true, size: files.size } : files.size) : { success: true, size: 100 } },
      readBytes(path, options) { return { success: true, data: new Uint8Array(options.length || 16), size: 100 } },
      writeBytes(path, data, options) { fileCalls.push({ type: 'write', path, offset: options.offset, length: data.byteLength || data.length }); return { success: true } },
    },
    Date, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, Promise, encodeURIComponent, decodeURIComponent, Uint8Array,
  }
  runInNewContext(source, context, { filename: 'yandex-music/index.js', timeout: 1000 })
  return { extension, requests, fileCalls, cryptoCalls, decryptCalls }
}

test('search results are normalized for Lokal with artwork, album and duration', () => {
  const provider = createProvider({
    routes: {
      '/search\\?': {
        result: {
          tracks: { results: [{
            id: 12, title: 'A Track', durationMs: 210000,
            artists: [{ id: 4, name: 'An Artist' }],
            albums: [{ id: 5, title: 'An Album', year: 2024, coverUri: 'avatars.yandex.net/cover/%%', trackPosition: { volume: 1, index: 2 }, artists: [{ id: 4, name: 'An Artist' }] }]
          }] }
        }
      }
    }
  })
  provider.extension.initialize({ token: 'abc123' })
  const results = provider.extension.searchTracks('A Track', 10)
  assert.equal(results.length, 1)
  assert.equal(results[0].id, '12')
  assert.equal(results[0].artist, 'An Artist')
  assert.equal(results[0].album_name, 'An Album')
  assert.equal(results[0].duration_ms, 210000)
  assert.equal(results[0].track_number, 2)
  assert.match(results[0].cover_url, /^https:\/\//)
  assert.equal(provider.requests[0].headers.Authorization, 'OAuth abc123')
})

test('album and artist search filters produce browseable catalogue items', () => {
  const provider = createProvider({
    routes: {
      'type=album': { result: { albums: { results: [{ id: 5, title: 'Album', artists: [{ id: 4, name: 'Artist' }], coverUri: 'https://img.example/cover.jpg' }] } } },
      'type=artist': { result: { artists: { results: [{ id: 4, name: 'Artist', ogImage: 'avatars.yandex.net/artist/%%' }] } } }
    }
  })
  provider.extension.initialize({ token: 'abc123' })
  const albums = provider.extension.customSearch('Album', { filter: 'albums', limit: 5 }).tracks
  const artists = provider.extension.customSearch('Artist', { filter: 'artists', limit: 5 }).tracks
  assert.equal(albums[0].item_type, 'album')
  assert.equal(albums[0].id, '5')
  assert.equal(artists[0].item_type, 'artist')
  assert.equal(artists[0].name, 'Artist')
})

test('download signing and raw file transfer request the selected quality', async () => {
  const provider = createProvider({
    routes: {
      '/get-file-info': {
        result: { downloadInfo: { quality: 'lossless', codec: 'flac', urls: ['https://storage.mds.yandex.net/audio'], key: '' } }
      }
    }
  })
  provider.extension.initialize({ token: 'abc123' })
  const result = await provider.extension.download('12', 'lossless', '/staged/audio.flac', () => {})
  assert.equal(result.success, true)
  assert.equal(result.file_path, '/staged/audio.flac')
  assert.equal(provider.cryptoCalls.length, 1)
  assert.match(provider.cryptoCalls[0].message, /12lossless/)
  assert.equal(provider.cryptoCalls[0].key, 'p93jhgh689SBReK6ghtw62')
  assert.equal(provider.fileCalls[0].url, 'https://storage.mds.yandex.net/audio')
})

test('missing OAuth token fails with an actionable setup message', () => {
  const provider = createProvider({ token: '' })
  provider.extension.initialize({})
  assert.throws(() => provider.extension.searchTracks('test', 5), /OAuth token/)
})

test('albums with only trackIds fetch tracks in batches instead of serial requests', () => {
  const provider = createProvider({
    routes: {
      '/albums/99/with-tracks': { result: { id: 99, title: 'Batch Album', trackIds: [1, 2, 3] } },
      'track-ids=1%2C2%2C3': { result: [
        { id: 1, title: 'Track 1', artists: [] },
        { id: 2, title: 'Track 2', artists: [] },
        { id: 3, title: 'Track 3', artists: [] }
      ] }
    }
  })
  provider.extension.initialize({ token: 'abc123' })
  const album = provider.extension.getAlbum(99)
  assert.deepEqual(album.tracks.map(track => track.id), ['1', '2', '3'])
  assert.equal(provider.requests.filter(request => /\/tracks\?/.test(request.url)).length, 1)
})

test('bare Yandex Music track URLs resolve without an album path', () => {
  const provider = createProvider({
    routes: {
      'track-ids=123': { result: [{ id: 123, title: 'Linked Track', artists: [] }] }
    }
  })
  provider.extension.initialize({ token: 'abc123' })
  const result = provider.extension.handleUrl('https://music.yandex.ru/track/123?from=share')
  assert.equal(result.tracks.length, 1)
  assert.equal(result.tracks[0].id, '123')
  assert.equal(result.tracks[0].title, 'Linked Track')
})

test('elementary AAC codecs use .aac while MP4 AAC uses .m4a', async () => {
  for (const [codec, extension] of [['aac', '.aac'], ['he-aac', '.aac'], ['aac-mp4', '.m4a'], ['he-aac-mp4', '.m4a']]) {
    const provider = createProvider({
      routes: {
        '/get-file-info': () => ({ statusCode: 200, body: JSON.stringify({ result: { downloadInfo: { codec, urls: ['https://audio.example/file'], key: '' } } }) })
      }
    })
    provider.extension.initialize({ token: 'abc123' })
    const result = await provider.extension.download('12', 'high', '/staged/audio.flac')
    assert.equal(result.output_extension, extension, codec)
    assert.ok(result.file_path.endsWith(extension), codec)
  }
})

test('encrypted downloads decrypt across 8 MiB chunks and remove the encrypted temporary file', async () => {
  const chunkSize = 8 * 1024 * 1024
  const provider = createProvider({
    files: { size: chunkSize + 32 },
    routes: {
      '/get-file-info': {
        result: { downloadInfo: { codec: 'flac', urls: ['https://storage.mds.yandex.net/encrypted'], key: '00112233445566778899aabbccddeeff' } }
      }
    }
  })
  provider.extension.initialize({ token: 'abc123' })
  const result = await provider.extension.download('12', 'lossless', '/staged/audio.flac')
  assert.equal(result.success, true)
  assert.deepEqual(provider.decryptCalls.map(call => call.length), [chunkSize, 32])
  assert.deepEqual(provider.decryptCalls.map(call => call.iv), [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0]
  ])
  const writes = provider.fileCalls.filter(call => call.type === 'write')
  assert.deepEqual(writes.map(call => call.offset), [0, chunkSize])
  assert.deepEqual(writes.map(call => call.length), [chunkSize, 32])
  assert.equal(writes.every(call => call.path === '/staged/audio.flac'), true)
  assert.ok(provider.fileCalls.some(call => call.type === 'delete' && call.path === '/staged/audio.flac.encrypted'))
})

test('failed encrypted decryption deletes both partial output and encrypted temporary file', async () => {
  const chunkSize = 8 * 1024 * 1024
  const provider = createProvider({
    files: { size: chunkSize + 32, failDecryptAt: 2 },
    routes: {
      '/get-file-info': {
        result: { downloadInfo: { codec: 'flac', urls: ['https://storage.mds.yandex.net/encrypted'], key: '00112233445566778899aabbccddeeff' } }
      }
    }
  })
  provider.extension.initialize({ token: 'abc123' })
  await assert.rejects(provider.extension.download('12', 'lossless', '/staged/audio.flac'), /audio decryption failed/)
  assert.ok(provider.fileCalls.some(call => call.type === 'write' && call.path === '/staged/audio.flac' && call.offset === 0))
  assert.ok(provider.fileCalls.some(call => call.type === 'delete' && call.path === '/staged/audio.flac'))
  assert.ok(provider.fileCalls.some(call => call.type === 'delete' && call.path === '/staged/audio.flac.encrypted'))
})
