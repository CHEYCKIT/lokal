// Soulseek built in: sign in with a Soulseek username and password and Lokal
// runs slskd (github.com/slskd/slskd, AGPL-3.0) for you, as a separate,
// unmodified program it downloads once from slskd's own releases and
// checks against the hashes below. Settings → Soulseek can update it to
// slskd's latest release, checked against the SHA-256 GitHub lists for it. It listens on this computer only, with
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

// The version a first install gets; updates replace it (current.json).
const VERSION = '0.26.1'
const LATEST_URL = 'https://api.github.com/repos/slskd/slskd/releases/latest'
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

/** 1 when version a is newer than b, -1 when older, 0 when the same ("0.26.1", "v0.27.0"). */
function compareVersions(a, b) {
  const parts = v => String(v || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1
  return 0
}

/** This computer's download in slskd's latest release (GitHub's API answer), with its sha256; null if none. */
function latestAsset(release, platform = process.platform, arch = process.arch) {
  const found = ASSETS[`${platform}-${arch}`]
  const version = String(release?.tag_name || '').replace(/^v/i, '')
  if (!found || !/^\d+\.\d+\.\d+$/.test(version) || release?.draft || release?.prerelease) return null
  const file = (release.assets || []).find(a => a?.name === `slskd-${version}-${found.asset}.zip`)
  const sha256 = String(file?.digest || '').match(/^sha256:([0-9a-f]{64})$/i)?.[1]?.toLowerCase()
  if (!file || !sha256) return null
  return { version, asset: found.asset, sha256, url: `https://github.com/slskd/slskd/releases/download/${version}/${file.name}`, notes: `https://github.com/slskd/slskd/releases/tag/${version}` }
}

function paths(base, version = VERSION) {
  return {
    base,
    version,
    bin: path.join(base, `slskd-${version}`),
    exe: path.join(base, `slskd-${version}`, process.platform === 'win32' ? 'slskd.exe' : 'slskd'),
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
  constructor({ baseDir, download, downloadRoot = () => '', onChange = () => {}, spawnImpl = spawn, fetchImpl = (...a) => fetch(...a) }) {
    this.dirs = paths(baseDir, installedVersion(baseDir))
    this.download = download // (url, dest, onProgress) => Promise
    this.downloadRoot = downloadRoot // selected root is read on the next connection
    this.onChange = onChange
    this.spawn = spawnImpl
    this.fetch = fetchImpl
    this.state = { phase: 'stopped', progress: 0, error: '' }
    this.proc = null
    this.connection = null // { url, apiKey, downloadsDir, account }
    this.starting = null
    this.account = null // the last one it started with, to start again after an update
    this.update = null // what checkUpdate() found: { version, url, sha256, notes } | null
    this.generation = 0 // bumped by stop(): a start it interrupts gives up instead of carrying on
  }

  set(next) { this.state = { ...this.state, ...next }; try { this.onChange(this.status()) } catch {} }
  status() {
    return { ...this.state, version: this.dirs.version, installed: this.installed(), running: !!this.connection, update: this.update ? { version: this.update.version, notes: this.update.notes } : null }
  }
  installed() { try { return fs.statSync(this.dirs.exe).isFile() } catch { return false } }

  async install() {
    if (this.installed()) return
    const asset = this.dirs.version === VERSION ? assetFor() : null
    if (!asset) {
      // An updated version that's gone missing: back to the one Lokal ships with.
      if (this.dirs.version !== VERSION) { this.dirs = paths(this.dirs.base, VERSION); writeInstalledVersion(this.dirs.base, VERSION); return this.install() }
      throw new Error(`Soulseek built in isn't available for ${process.platform} ${process.arch}.`)
    }
    await this.fetchBuild({ ...asset, version: VERSION }, this.dirs)
  }

  /** Download, check and unpack one slskd build into dirs.bin. */
  async fetchBuild(asset, dirs, phase = 'installing') {
    fs.mkdirSync(dirs.base, { recursive: true })
    const zip = path.join(dirs.base, `slskd-${asset.version}.zip.part`)
    this.set({ phase, progress: 0, error: '' })
    try {
      await this.download(asset.url, zip, progress => this.set({ progress: Math.round(Number(progress?.percent ?? progress) || 0) }))
      this.set({ progress: 100 })
      if (await sha256File(zip) !== asset.sha256) throw new Error("The downloaded Soulseek client didn't match its expected checksum, so it wasn't used.")
      const staging = `${dirs.bin}.staging`
      fs.rmSync(staging, { recursive: true, force: true })
      const AdmZip = require('adm-zip')
      new AdmZip(zip).extractAllTo(staging, true)
      if (process.platform !== 'win32') fs.chmodSync(path.join(staging, 'slskd'), 0o755)
      fs.rmSync(dirs.bin, { recursive: true, force: true })
      fs.renameSync(staging, dirs.bin)
    } finally {
      fs.rmSync(zip, { force: true })
    }
  }

  /** Is there a newer slskd than the one installed? Remembers it for update() and status(). */
  async checkUpdate() {
    let res
    try { res = await this.fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Lokal' } }) } catch { res = null }
    if (!res?.ok) throw new Error(res?.status === 403 || res?.status === 429 ? 'GitHub is limiting requests for now. Try again later.' : "Couldn't reach GitHub to check for a newer Soulseek client.")
    const release = await res.json()
    const latest = latestAsset(release)
    const newer = latest && compareVersions(latest.version, this.dirs.version) > 0
    if (!latest && compareVersions(String(release?.tag_name || ''), this.dirs.version) > 0) {
      throw new Error(`slskd ${String(release.tag_name).replace(/^v/i, '')} is out, but has no checked download for this computer yet. Try again later.`)
    }
    this.update = newer ? latest : null
    this.set({})
    return { current: this.dirs.version, latest: latest?.version || this.dirs.version, update: this.update ? { version: this.update.version, notes: this.update.notes } : null }
  }

  /**
   * Install the newer slskd checkUpdate() found, then start it again signed
   * in as before (if it was running). The old version is removed once the
   * new one is in place; a failed update leaves the old one as it was.
   */
  async updateClient() {
    if (!this.update) await this.checkUpdate()
    const next = this.update
    if (!next) return this.status()
    if (this.starting) await this.starting.promise.catch(() => {})
    const account = this.connection ? this.account : null
    const old = this.dirs
    const dirs = paths(old.base, next.version)
    try {
      await this.stop()
      await this.fetchBuild(next, dirs, 'updating')
    } catch (error) {
      this.set({ phase: 'error', error: error.message })
      if (account) await this.ensureRunning(account).catch(() => {})
      throw error
    }
    this.dirs = dirs
    writeInstalledVersion(old.base, next.version)
    this.update = null
    if (old.bin !== dirs.bin) fs.rmSync(old.bin, { recursive: true, force: true })
    this.set({ phase: 'stopped', progress: 0, error: '' })
    if (account) await this.ensureRunning(account)
    return this.status()
  }

  /** Running, signed in as `account` (installing first if needed). */
  ensureRunning(account) {
    const username = String(account?.username || '').trim()
    const password = String(account?.password || '')
    if (!username || !password) return Promise.reject(new Error('Sign in to Soulseek in Settings → Integrations first.'))
    const key = `${username}\u0000${crypto.createHash('sha256').update(password).digest('hex')}\u0000${(account.shared || []).join(';')}\u0000${this.downloadRoot()}`
    if (this.connection && this.connection.account === key) return Promise.resolve(this.connection)
    if (this.starting?.key === key) return this.starting.promise
    let generation
    // Signed out (stop()) while this was downloading or starting: don't carry on.
    const stillWanted = () => { if (generation !== this.generation) throw Object.assign(new Error('Signing in to Soulseek was cancelled.'), { cancelled: true }) }
    const promise = (async () => {
      await this.stop()
      generation = this.generation
      this.account = account
      await this.install()
      stillWanted()
      // Large Soulseek .part files should not fill the system drive when a
      // different download disk is selected. Keep its executable, app profile
      // and credentials in their existing location.
      const selected = this.downloadRoot()
      const current = paths(this.dirs.base, this.dirs.version)
      this.dirs = selected ? {
        ...current,
        downloads: path.join(selected, '.lokal-soulseek', 'downloads'),
        incomplete: path.join(selected, '.lokal-soulseek', 'incomplete'),
      } : current
      this.set({ phase: 'starting', error: '' })
      for (const dir of [this.dirs.app, this.dirs.downloads, this.dirs.incomplete]) fs.mkdirSync(dir, { recursive: true })
      const port = await freePort()
      stillWanted()
      const apiKey = crypto.randomBytes(24).toString('hex')
      const env = { ...process.env, ...environment({ username, password, apiKey, dirs: this.dirs, shared: account.shared || [] }) }
      const proc = this.spawn(this.dirs.exe, args({ port, dirs: this.dirs }), { env, cwd: this.dirs.bin, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      this.proc = proc
      let output = ''
      const keep = chunk => { output = (output + chunk).slice(-4000) }
      proc.stdout?.on('data', keep); proc.stderr?.on('data', keep)
      // It couldn't be started at all (missing, not allowed to run): an error for Settings, not a crash.
      proc.on('error', error => {
        proc.startError = `The Soulseek client couldn't start: ${error.message}`
        if (this.proc !== proc) return
        this.proc = null; this.connection = null
        this.set({ phase: 'error', error: proc.startError })
      })
      proc.on('exit', code => {
        if (this.proc !== proc) return
        this.proc = null; this.connection = null
        this.set({ phase: 'stopped', error: code ? (lastError(output) || `The Soulseek client stopped (code ${code}).`) : '' })
      })
      const url = `http://127.0.0.1:${port}`
      await this.waitReady(url, apiKey, proc)
      stillWanted()
      this.connection = { url, apiKey, downloadsDir: this.dirs.downloads, account: key }
      this.set({ phase: 'running', error: '' })
      return this.connection
    })().catch(error => {
      if (!error.cancelled) this.set({ phase: 'error', error: error.message })
      throw error
    }).finally(() => { if (this.starting?.promise === promise) this.starting = null })
    this.starting = { key, promise }
    return promise
  }

  async waitReady(url, apiKey, proc) {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.proc !== proc) throw new Error(proc.startError || 'The Soulseek client stopped while starting.')
      const res = await this.fetch(`${url}/api/v0/application`, { headers: { 'X-API-Key': apiKey } }).catch(() => null)
      if (res?.ok) return
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error("The Soulseek client didn't start in time.")
  }

  stop() {
    this.generation++
    this.starting = null
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

/** The version installed (an update's, from current.json), or the one Lokal ships with. */
function installedVersion(base) {
  try {
    const version = JSON.parse(fs.readFileSync(path.join(base, 'current.json'), 'utf8'))?.version
    if (/^\d+\.\d+\.\d+$/.test(String(version || ''))) return version
  } catch {}
  return VERSION
}

function writeInstalledVersion(base, version) {
  fs.mkdirSync(base, { recursive: true })
  fs.writeFileSync(path.join(base, 'current.json'), JSON.stringify({ version }))
}

/** The useful line of slskd's output when it quits (an invalid setting, say). */
function lastError(output) {
  const lines = String(output || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  return lines.reverse().find(line => /error|invalid|fail|exception/i.test(line)) || ''
}

module.exports = { ManagedSlskd, assetFor, latestAsset, compareVersions, environment, args, paths, lastError, VERSION, LATEST_URL }
