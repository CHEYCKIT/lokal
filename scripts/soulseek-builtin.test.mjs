import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const require = createRequire(import.meta.url)
const { ManagedSlskd, assetFor, environment, args, lastError } = require('../electron/download/slskdManaged.js')
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

test('slskd calls in built-in mode go to the client Lokal runs', async () => {
  const server = http.createServer((req, res) => {
    if (req.headers['x-api-key'] !== 'test-key') { res.writeHead(401); res.end(); return }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.url === '/api/v0/application' ? { server: { state: 'Connected, LoggedIn', isLoggedIn: true }, user: { username: 'me' }, version: { current: '0.26.1' } } : {}))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  let connects = 0
  slskd.useManaged({ connect: async () => { connects++ }, current: () => ({ url, apiKey: 'test-key' }), downloadsDir: '/tmp' })
  const status = await slskd.status({ soulseek_mode: 'builtin' })
  assert.equal(status.loggedIn, true)
  assert.equal(status.username, 'me')
  assert.ok(connects >= 1)
  // An account and no slskd key, from before the switch existed: built in too.
  assert.equal(slskd.isBuiltin({ soulseek_username: 'me' }), true)
  assert.equal(slskd.isBuiltin({ soulseek_username: 'me', soulseek_api_key: 'k' }), false)
  assert.equal(slskd.isBuiltin({ soulseek_mode: 'external', soulseek_username: 'me' }), false)
  slskd.useManaged(null)
  await assert.rejects(slskd.status({ soulseek_mode: 'builtin' }), /desktop app/)
  server.close()
})
