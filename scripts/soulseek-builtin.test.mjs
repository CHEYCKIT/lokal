import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const require = createRequire(import.meta.url)
const { ManagedSlskd, assetFor, latestAsset, compareVersions, environment, args, lastError, VERSION, LATEST_URL } = require('../electron/download/slskdManaged.js')
const AdmZip = require('adm-zip')
const crypto = require('crypto')
const slskd = require('../electron/download/slskd.js')

test('every platform Lokal ships has a pinned slskd build', () => {
  for (const [platform, arch, asset] of [['win32', 'x64', 'win-x64'], ['win32', 'arm64', 'win-arm64'], ['darwin', 'x64', 'osx-x64'], ['darwin', 'arm64', 'osx-arm64'], ['linux', 'x64', 'linux-x64'], ['linux', 'arm64', 'linux-arm64']]) {
    const found = assetFor(platform, arch)
    assert.equal(found.asset, asset)
    assert.match(found.url, new RegExp(`^https://github\\.com/slskd/slskd/releases/download/[\\d.]+/slskd-[\\d.]+-${asset}\\.zip$`))
    assert.match(found.sha256, /^[0-9a-f]{64}$/)
  }
  assert.equal(assetFor('linux', 'ia32'), null)
})

test('the account goes in the environment, never on the command line; local-only HTTP', () => {
  const dirs = { app: '/a', downloads: '/d', incomplete: '/i' }
  const env = environment({ username: 'me', password: 's3cret', apiKey: 'k'.repeat(48), dirs })
  assert.equal(env.SLSKD_SLSK_USERNAME, 'me')
  assert.equal(env.SLSKD_SLSK_PASSWORD, 's3cret')
  assert.equal(env.SLSKD_NO_SHARE_SCAN, 'true')
  assert.equal(environment({ username: 'me', password: 'x', apiKey: 'k', dirs, shared: ['/m1', '/m2'] }).SLSKD_SHARED_DIR, '/m1;/m2')
  const argv = args({ port: 50123, dirs })
  assert.ok(!argv.join(' ').includes('s3cret'))
  assert.deepEqual(argv.slice(argv.indexOf('--http-ip-address'), argv.indexOf('--http-ip-address') + 2), ['--http-ip-address', '127.0.0.1'])
  assert.ok(argv.includes('--no-https'))
  assert.equal(lastError('[INF] ok\n[ERR] Invalid configuration: x\n'), '[ERR] Invalid configuration: x')
})

function fakeClient({ ready = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-slskd-'))
  const spawned = []
  const client = new ManagedSlskd({
    baseDir: base,
    download: async () => { throw new Error('no downloads in tests') },
    spawnImpl: (exe, argv, opts) => {
      const proc = new EventEmitter(); proc.exitCode = null; proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter()
      proc.kill = () => { proc.exitCode = 0; setImmediate(() => proc.emit('exit', 0)) }
      spawned.push({ exe, argv, env: opts.env, proc }); return proc
    },
    fetchImpl: async () => ({ ok: ready }),
  })
  fs.mkdirSync(client.dirs.bin, { recursive: true }); fs.writeFileSync(client.dirs.exe, '')
  return { client, spawned, base }
}

test('signing in starts one client, reuses it, and restarts it for another account', async () => {
  const { client, spawned, base } = fakeClient()
  await assert.rejects(client.ensureRunning({ username: '', password: 'x' }), /Sign in/)
  const [a, b] = await Promise.all([client.ensureRunning({ username: 'me', password: 'pw' }), client.ensureRunning({ username: 'me', password: 'pw' })])
  assert.equal(spawned.length, 1)
  assert.equal(a, b)
  assert.match(a.url, /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.equal(spawned[0].env.SLSKD_API_KEY, a.apiKey)
  assert.equal(spawned[0].env.SLSKD_SLSK_PASSWORD, 'pw')
  for (const dir of ['app', 'downloads', 'incomplete']) assert.ok(fs.existsSync(client.dirs[dir]), `${dir} made before start`)
  assert.equal(client.status().phase, 'running')
  await client.ensureRunning({ username: 'me', password: 'pw' })
  assert.equal(spawned.length, 1)
  await client.ensureRunning({ username: 'other', password: 'pw' })
  assert.equal(spawned.length, 2)
  assert.notEqual(spawned[0].proc.exitCode, null) // the first one was stopped
  await client.stop()
  assert.equal(client.status().running, false)
  fs.rmSync(base, { recursive: true, force: true })
})

test('slskd calls go to the client Lokal runs', async () => {
  const server = http.createServer((req, res) => {
    if (req.headers['x-api-key'] !== 'test-key') { res.writeHead(401); res.end(); return }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.url === '/api/v0/application' ? { server: { state: 'Connected, LoggedIn', isLoggedIn: true }, user: { username: 'me' }, version: { current: '0.26.1' } } : {}))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  let connects = 0
  slskd.useManaged({ connect: async () => { connects++ }, current: () => ({ url, apiKey: 'test-key' }), downloadsDir: '/tmp' })
  const status = await slskd.status({ soulseek_username: 'me' })
  assert.equal(status.loggedIn, true)
  assert.equal(status.username, 'me')
  assert.ok(connects >= 1)
  // Settings from the old "my own slskd" option are ignored: always this client.
  assert.equal((await slskd.status({ soulseek_mode: 'external', soulseek_url: 'http://elsewhere:5030', soulseek_api_key: 'old' })).username, 'me')
  slskd.useManaged(null)
  await assert.rejects(slskd.status({}), /desktop app/)
  server.close()
})

const PLATFORM_ASSET = assetFor()?.asset
const release = (version, digest, extra = {}) => ({
  tag_name: version, draft: false, prerelease: false,
  assets: [{ name: `slskd-${version}-${PLATFORM_ASSET}.zip`, digest }, { name: `slskd-${version}-other.zip`, digest: `sha256:${'0'.repeat(64)}` }],
  ...extra,
})

test('versions compare by number; the latest release gives this computer\'s file and its GitHub sha256', () => {
  assert.equal(compareVersions('0.27.0', '0.26.1'), 1)
  assert.equal(compareVersions('0.26.10', '0.26.9'), 1)
  assert.equal(compareVersions('v0.26.1', '0.26.1'), 0)
  assert.equal(compareVersions('0.26.1', '1.0.0'), -1)
  if (!PLATFORM_ASSET) return
  const sha = 'a'.repeat(64)
  const found = latestAsset(release('0.27.0', `sha256:${sha}`))
  assert.equal(found.version, '0.27.0')
  assert.equal(found.sha256, sha)
  assert.equal(found.url, `https://github.com/slskd/slskd/releases/download/0.27.0/slskd-0.27.0-${PLATFORM_ASSET}.zip`)
  // Nothing to check the file against, a pre-release, or an odd tag: no update offered.
  assert.equal(latestAsset(release('0.27.0', null)), null)
  assert.equal(latestAsset(release('0.27.0', `sha256:${sha}`, { prerelease: true })), null)
  assert.equal(latestAsset(release('nightly', `sha256:${sha}`)), null)
})

function zipWithSlskd(content) {
  const zip = new AdmZip()
  zip.addFile(process.platform === 'win32' ? 'slskd.exe' : 'slskd', Buffer.from(content))
  return zip.toBuffer()
}

test('updating installs the newer slskd, checked, starts it signed in again, and drops the old one', { skip: !PLATFORM_ASSET }, async () => {
  const { client, spawned, base } = fakeClient()
  const newer = '99.0.0'
  const zip = zipWithSlskd('new build')
  let digest = `sha256:${crypto.createHash('sha256').update(zip).digest('hex')}`
  const fetched = []
  client.fetch = async (url) => {
    if (url === LATEST_URL) return { ok: true, json: async () => release(newer, digest) }
    return { ok: true }
  }
  client.download = async (url, dest) => { fetched.push(url); fs.writeFileSync(dest, zip) }
  await client.ensureRunning({ username: 'me', password: 'pw' })
  const oldBin = client.dirs.bin

  // A download that doesn't match GitHub's sha256 isn't used; the old one keeps running.
  digest = `sha256:${'b'.repeat(64)}`
  await assert.rejects(client.updateClient(), /checksum/)
  assert.equal(client.status().version, VERSION)
  assert.equal(client.status().running, true)
  assert.ok(fs.existsSync(oldBin))

  digest = `sha256:${crypto.createHash('sha256').update(zip).digest('hex')}`
  const checked = await client.checkUpdate()
  assert.equal(checked.update.version, newer)
  assert.equal(client.status().update.version, newer)
  const after = await client.updateClient()
  assert.equal(after.version, newer)
  assert.equal(after.update, null)
  assert.equal(after.running, true)
  assert.equal(fs.readFileSync(client.dirs.exe, 'utf8'), 'new build')
  assert.equal(spawned.at(-1).exe, client.dirs.exe)
  assert.equal(spawned.at(-1).env.SLSKD_SLSK_USERNAME, 'me')
  assert.ok(!fs.existsSync(oldBin), 'old version removed')
  assert.ok(fetched.every(url => url.endsWith(`slskd-${newer}-${PLATFORM_ASSET}.zip`)))

  // Remembered: the next start (Lokal reopened) uses the updated version.
  const reopened = new ManagedSlskd({ baseDir: base, download: async () => {} })
  assert.equal(reopened.status().version, newer)
  assert.equal(reopened.installed(), true)
  // Nothing newer: up to date, nothing downloaded.
  const count = fetched.length
  assert.equal((await client.checkUpdate()).update, null)
  assert.equal((await client.updateClient()).version, newer)
  assert.equal(fetched.length, count)
  await client.stop()
  fs.rmSync(base, { recursive: true, force: true })
})

test('a GitHub limit or a newer release without a checked file says so', async () => {
  const { client, base } = fakeClient()
  client.fetch = async () => ({ ok: false, status: 403 })
  await assert.rejects(client.checkUpdate(), /limiting/)
  client.fetch = async () => { throw new Error('offline') }
  await assert.rejects(client.checkUpdate(), /Couldn't reach GitHub/)
  if (PLATFORM_ASSET) {
    client.fetch = async () => ({ ok: true, json: async () => release('99.0.0', null) })
    await assert.rejects(client.checkUpdate(), /no checked download/)
  }
  fs.rmSync(base, { recursive: true, force: true })
})

test('signing out while the client is still downloading stops it from starting afterwards', async () => {
  const { client, spawned, base } = fakeClient()
  let finish
  client.install = () => new Promise(resolve => { finish = resolve })
  const starting = client.ensureRunning({ username: 'me', password: 'pw' })
  await new Promise(resolve => setImmediate(resolve))
  await client.stop()
  finish()
  await assert.rejects(starting, /cancelled/)
  assert.equal(spawned.length, 0)
  assert.equal(client.status().running, false)
  assert.notEqual(client.status().phase, 'error')
  // Signing in again afterwards works.
  client.install = async () => {}
  await client.ensureRunning({ username: 'me', password: 'pw' })
  assert.equal(spawned.length, 1)
  await client.stop()
  fs.rmSync(base, { recursive: true, force: true })
})

test('a client that cannot be launched is an error for Settings, not a crash', async () => {
  const { client, base } = fakeClient({ ready: false })
  client.spawn = () => {
    const proc = new EventEmitter(); proc.exitCode = null; proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = () => {}
    setImmediate(() => proc.emit('error', Object.assign(new Error('spawn EACCES'), { code: 'EACCES' })))
    return proc
  }
  await assert.rejects(client.ensureRunning({ username: 'me', password: 'pw' }), /couldn't start: spawn EACCES/)
  assert.equal(client.status().phase, 'error')
  fs.rmSync(base, { recursive: true, force: true })
})
