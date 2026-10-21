import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { DownloadManager } = require('../electron/download/manager')
const packages = require('../electron/mornye/packages')
const sources = require('../electron/online/sources')

test('download manager recognizes installed Morneye package sources', () => {
  const originalService = packages.service
  packages.service = () => ({
    find: key => key === '0123456789' ? { key } : null,
  })

  try {
    const manager = new DownloadManager().configure({ getDB: () => ({}) })
    assert.equal(manager.isPackageSource({ provider: 'a-0123456789', id: 'fixture-song' }), true)
  } finally {
    packages.service = originalService
  }
})

test('Morneye cached audio is served by the Morneye media handler', async () => {
  const originalKeyOfProvider = sources.addons.keyOfProvider
  const originalResolveStream = sources.addons.resolveStream
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-morneye-stream-'))
  const file = path.join(dir, 'fixture.flac')
  const audio = Buffer.from('fLaC-fixture-audio')
  await fs.writeFile(file, audio)

  sources.addons.keyOfProvider = provider => provider === 'a-0123456789'
    ? '0123456789'
    : originalKeyOfProvider(provider)
  sources.addons.resolveStream = async (_db, key, id) => {
    assert.equal(key, '0123456789')
    assert.equal(id, 'fixture-song')
    return { type: 'file', file, mime: 'audio/flac', headers: {}, format: 'flac' }
  }

  try {
    const { res, mime } = await sources.fetchStream('a-0123456789', 'fixture-song', { db: {} })
    assert.equal(res.status, 200)
    assert.equal(mime, 'audio/flac')
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), audio)
  } finally {
    sources.addons.keyOfProvider = originalKeyOfProvider
    sources.addons.resolveStream = originalResolveStream
    await fs.rm(dir, { recursive: true, force: true })
  }
})
