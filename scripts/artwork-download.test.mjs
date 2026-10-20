import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { downloadImageWithTimeout } = require('../electron/artworkDownload.js')

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return 'http://127.0.0.1:' + server.address().port
}

test('downloads only complete files and follows redirects', async t => {
  const bytes = Buffer.from('cover-image-bytes')
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/cover' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'image/jpeg' })
    res.end(bytes)
  })
  const baseUrl = await listen(server)
  t.after(() => new Promise(resolve => server.close(resolve)))
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-art-download-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const destination = path.join(dir, 'artwork', 'cover.jpg')

  await downloadImageWithTimeout(baseUrl + '/redirect', destination, 2000)

  assert.deepEqual(await fs.readFile(destination), bytes)
  assert.deepEqual(await fs.readdir(path.dirname(destination)), ['cover.jpg'])
})

test('returns a rejected promise when the destination cannot be opened', async t => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.end('cover') })
  const baseUrl = await listen(server)
  t.after(() => new Promise(resolve => server.close(resolve)))
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-art-download-error-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const blocker = path.join(dir, 'not-a-directory')
  await fs.writeFile(blocker, 'x')

  await assert.rejects(downloadImageWithTimeout(baseUrl + '/cover', path.join(blocker, 'cover.jpg'), 2000))
})
