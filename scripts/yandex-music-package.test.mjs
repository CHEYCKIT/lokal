import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const source = readFileSync(new URL('../addons/yandex-music/index.js', import.meta.url), 'utf8')

function createProvider({ token = 'test-token', routes = {}, files = {} } = {}) {
  let extension
  const requests = []
  const fileCalls = []
  const cryptoCalls = []
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
        return { success: true, data: data, options }
      }
    },
    file: {
      download(url, dest, options) { fileCalls.push({ type: 'download', url, dest }); return { success: true, path: dest } },
      delete(path) { fileCalls.push({ type: 'delete', path }); return { success: true } },
      getSize(path) { return files.size || { success: true, size: 100 } },
      readBytes(path, options) { return { success: true, data: new Uint8Array(options.length || 16), size: 100 } },
      writeBytes(path, data, options) { fileCalls.push({ type: 'write', path, offset: options.offset, length: data.byteLength || data.length }); return { success: true } },
    },
    Date, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, Promise, encodeURIComponent, decodeURIComponent, Uint8Array,
  }
  runInNewContext(source, context, { filename: 'yandex-music/index.js', timeout: 1000 })
  return { extension, requests, fileCalls, cryptoCalls }
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
