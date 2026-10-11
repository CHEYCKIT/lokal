// Soulseek built in: sign in with a Soulseek username and password and Lokal
// runs slskd (github.com/slskd/slskd, AGPL-3.0) for you, as a separate,
// unmodified program it downloads once from slskd's own releases and
// checks against the hashes below. It listens on this computer only, with
// a key made up at each start; the account's password goes to it as an
// environment variable, never into a file. It stops when Lokal quits.
//
// The rest of Lokal talks to it exactly as to an slskd you run yourself
// (slskd.js): settings.soulseek_mode === 'builtin' points the same calls
// here.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const net = require('net')
const { spawn } = require('child_process')

const VERSION = '0.26.1'
// sha256 of slskd-<VERSION>-<asset>.zip from github.com/slskd/slskd/releases.
const ASSETS = {
  'win32-x64': { asset: 'win-x64', sha256: '14928215e6931f291dbc489cbeeccffba6d1aa0d5b94d4262705a596407d50d3' },
  'win32-arm64': { asset: 'win-arm64', sha256: 'bf0c4fcbfab58350a6684925c0e744c940aa4b6a0a282ddbefb8a2b619ff09ed' },
  'darwin-x64': { asset: 'osx-x64', sha256: 'ccc278d659a658787a575cc40a0be9a19511e0578ba457a4c0675db987e4e8e7' },
  'darwin-arm64': { asset: 'osx-arm64', sha256: '5cf79a4d41ad40906aababc6bd05585899f102e7c544e38157df747f01cb6f4b' },
  'linux-x64': { asset: 'linux-x64', sha256: '26c862173c593142db3fcfcd78f0784cfc29987de40a5bd9c2e662ed3b84cce6' },
  'linux-arm64': { asset: 'linux-arm64', sha256: '2349a8a6e632af88cdce475b30566dfa4ab6ca02774dd33441ed607b2613fd12' },
}
const READY_TIMEOUT_MS = 45000

/** This computer's slskd download, or null when slskd has no build for it. */
function assetFor(platform = process.platform, arch = process.arch) {
  const found = ASSETS[`${platform}-${arch}`]
  if (!found) return null
  return { ...found, url: `https://github.com/slskd/slskd/releases/download/${VERSION}/slskd-${VERSION}-${found.asset}.zip` }
}

function paths(base) {
  return {
    base,
    bin: path.join(base, `slskd-${VERSION}`),
    exe: path.join(base, `slskd-${VERSION}`, process.platform === 'win32' ? 'slskd.exe' : 'slskd'),
    app: path.join(base, 'app'),
    downloads: path.join(base, 'downloads'),
    incomplete: path.join(base, 'incomplete'),
  }
}

/** The environment slskd starts with: the account, its folders, sharing. */
function environment({ username, password, apiKey, dirs, shared = [] }) {
  return {
    SLSKD_SLSK_USERNAME: username,
    SLSKD_SLSK_PASSWORD: password,
    SLSKD_API_KEY: apiKey,
    SLSKD_DOWNLOADS_DIR: dirs.downloads,
    SLSKD_INCOMPLETE_DIR: dirs.incomplete,
    SLSKD_SLSK_DESCRIPTION: 'Lokal (slskd)',
    ...(shared.length ? { SLSKD_SHARED_DIR: shared.join(';') } : { SLSKD_NO_SHARE_SCAN: 'true' }),
  }
}

function args({ port, dirs }) {
  return ['--app-dir', dirs.app, '--http-port', String(port), '--http-ip-address', '127.0.0.1', '--no-https', '--no-logo', '--no-version-check', '--no-config-watch']
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) })
  })
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(file).on('error', reject).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')))
  })
}

class ManagedSlskd {
  constructor({ baseDir, download, onChange = () => {}, spawnImpl = spawn, fetchImpl = (...a) => fetch(...a) }) {
    this.dirs = paths(baseDir)
    this.download = download // (url, dest, onProgress) => Promise
    this.onChange = onChange
    this.spawn = spawnImpl
    this.fetch = fetchImpl
    this.state = { phase: 'stopped', progress: 0, error: '' }
    this.proc = null
    this.connection = null // { url, apiKey, downloadsDir, account }
    this.starting = null
  }

  set(next) { this.state = { ...this.state, ...next }; try { this.onChange(this.status()) } catch {} }
  status() { return { ...this.state, version: VERSION, installed: this.installed(), running: !!this.connection } }
  installed() { try { return fs.statSync(this.dirs.exe).isFile() } catch { return false } }

  async install() {
    if (this.installed()) return
    const asset = assetFor()
    if (!asset) throw new Error(`Soulseek built in isn't available for ${process.platform} ${process.arch}. Use your own slskd instead.`)
    fs.mkdirSync(this.dirs.base, { recursive: true })
    const zip = path.join(this.dirs.base, `slskd-${VERSION}.zip.part`)
    this.set({ phase: 'installing', progress: 0, error: '' })
    try {
      await this.download(asset.url, zip, progress => this.set({ progress: Math.round(Number(progress?.percent ?? progress) || 0) }))
      this.set({ progress: 100 })
      if (await sha256File(zip) !== asset.sha256) throw new Error("The downloaded Soulseek client didn't match its expected checksum, so it wasn't used.")
      const staging = `${this.dirs.bin}.staging`
      fs.rmSync(staging, { recursive: true, force: true })
      const AdmZip = require('adm-zip')
      new AdmZip(zip).extractAllTo(staging, true)
      if (process.platform !== 'win32') fs.chmodSync(path.join(staging, 'slskd'), 0o755)
      fs.rmSync(this.dirs.bin, { recursive: true, force: true })
      fs.renameSync(staging, this.dirs.bin)
    } finally {
      fs.rmSync(zip, { force: true })
    }
  }

  /** Running, signed in as `account` (installing first if needed). */
  ensureRunning(account) {
    const username = String(account?.username || '').trim()
    const password = String(account?.password || '')
    if (!username || !password) return Promise.reject(new Error('Sign in to Soulseek in Settings → Integrations first.'))
    const key = `${username}\u0000${crypto.createHash('sha256').update(password).digest('hex')}\u0000${(account.shared || []).join(';')}`
    if (this.connection && this.connection.account === key) return Promise.resolve(this.connection)
    if (this.starting?.key === key) return this.starting.promise
    const promise = (async () => {
      await this.stop()
      await this.install()
      this.set({ phase: 'starting', error: '' })
      for (const dir of [this.dirs.app, this.dirs.downloads, this.dirs.incomplete]) fs.mkdirSync(dir, { recursive: true })
      const port = await freePort()
      const apiKey = crypto.randomBytes(24).toString('hex')
      const env = { ...process.env, ...environment({ username, password, apiKey, dirs: this.dirs, shared: account.shared || [] }) }
      const proc = this.spawn(this.dirs.exe, args({ port, dirs: this.dirs }), { env, cwd: this.dirs.bin, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      this.proc = proc
      let output = ''
      const keep = chunk => { output = (output + chunk).slice(-4000) }
      proc.stdout?.on('data', keep); proc.stderr?.on('data', keep)
      proc.on('exit', code => {
        if (this.proc !== proc) return
        this.proc = null; this.connection = null
        this.set({ phase: 'stopped', error: code ? (lastError(output) || `The Soulseek client stopped (code ${code}).`) : '' })
      })
      const url = `http://127.0.0.1:${port}`
      await this.waitReady(url, apiKey, proc)
      this.connection = { url, apiKey, downloadsDir: this.dirs.downloads, account: key }
      this.set({ phase: 'running', error: '' })
      return this.connection
    })().catch(error => {
      this.set({ phase: 'error', error: error.message })
      throw error
    }).finally(() => { if (this.starting?.promise === promise) this.starting = null })
    this.starting = { key, promise }
    return promise
  }

  async waitReady(url, apiKey, proc) {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.proc !== proc) throw new Error('The Soulseek client stopped while starting.')
      const res = await this.fetch(`${url}/api/v0/application`, { headers: { 'X-API-Key': apiKey } }).catch(() => null)
      if (res?.ok) return
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error("The Soulseek client didn't start in time.")
  }

  stop() {
    const proc = this.proc
    this.proc = null; this.connection = null
    if (!proc || proc.exitCode !== null) { this.set({ phase: 'stopped' }); return Promise.resolve() }
    return new Promise(resolve => {
      const timer = setTimeout(() => { try { proc.kill('SIGKILL') } catch {} ; resolve() }, 4000)
      proc.once('exit', () => { clearTimeout(timer); resolve() })
      try { proc.kill() } catch { clearTimeout(timer); resolve() }
      this.set({ phase: 'stopped' })
    })
  }
}

/** The useful line of slskd's output when it quits (an invalid setting, say). */
function lastError(output) {
  const lines = String(output || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  return lines.reverse().find(line => /error|invalid|fail|exception/i.test(line)) || ''
}

module.exports = { ManagedSlskd, assetFor, environment, args, paths, lastError, VERSION }
