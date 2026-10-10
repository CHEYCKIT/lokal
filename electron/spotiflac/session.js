const crypto = require('crypto')
const { validateURL } = require('./network')

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex')
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest('base64url')
function signedHeaders(config, record, method, url, body, now = Date.now(), nonce = crypto.randomBytes(16).toString('hex')) {
  const prefix = config.headerPrefix || 'X-Sig-'
  const timestamp = new Date(now).toISOString()
  const hash = sha256(body)
  const window = Math.floor(now / 1000 / (config.timeWindowSeconds || 300))
  const rolling = hmac(record.session_secret, `${window}:${record.session_id}`)
  const canonical = [config.schemeLabel || 'SPOTIFLAC-HMAC-V1', method.toUpperCase(), new URL(url).pathname, '', hash, timestamp, nonce, record.session_id, config.appVersion || 'ext-1.0', config.platform || 'extension'].join('\n')
  return Object.fromEntries(Object.entries({ Session: record.session_id, Timestamp: timestamp, Nonce: nonce, 'Body-SHA256': hash, Signature: hmac(rolling, canonical), 'App-Version': config.appVersion || 'ext-1.0', Platform: config.platform || 'extension' }).map(([key,value]) => [prefix + key,value]))
}
class SignedSession {
  constructor(config, storage, network, owner) {
    this.config = config; this.storage = storage; this.network = network; this.owner = owner
    this.namespace = sha256([config.namespace || owner, config.baseUrl, config.appVersion || 'ext-1.0', config.platform || 'extension'].join('\n'))
    this.generation = 0
  }
  record() {
    const record = this.storage.read(this.namespace, 'session')
    if (!record.install_id) { record.install_id = crypto.randomBytes(16).toString('hex'); this.save(record) }
    return record
  }
  save(record) { this.storage.write(this.namespace, 'session', record) }
  usable(record) { return !!(record.session_id && record.session_secret && Date.parse(record.expires_at) > Date.now()) }
  endpoint(path) {
    const base = new URL(this.config.baseUrl)
    const url = new URL(`${base.href.replace(/\/$/, '')}/${String(path).replace(/^\/+/, '')}`)
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/')) throw new Error('Signed-session path escaped its base URL')
    return url.href
  }
  status() {
    const record = this.record()
    return { authenticated: this.usable(record) && !this.blocked, verification_required: !!this.pending, expires_at: record.expires_at || '', session_id: record.session_id || '', install_id: record.install_id, app_version: this.config.appVersion || 'ext-1.0', platform: this.config.platform || 'extension', auth_url: this.pending?.url || '' }
  }
  clear() { const record = this.record(); this.generation++; this.save({ install_id: record.install_id }); this.pending = null; this.blocked = false; return { success: true } }
  verification() { return { ok: false, needsVerification: true, error: 'VERIFY_REQUIRED', auth_url: this.pending?.url || '', open_auth_url: this.pending?.url || '' } }
  async bootstrap(signal) {
    if (this.flight) return this.flight
    this.flight = (async () => {
      const generation = this.generation, record = this.record()
      const url = new URL(this.endpoint(this.config.endpoints?.bootstrap || '/bootstrap'))
      url.searchParams.set('app_version', this.config.appVersion || 'ext-1.0'); url.searchParams.set('install_id', record.install_id)
      const response = await this.network.jsonResponse(url.href, { signal })
      if (!response.ok) throw new Error(`Signed-session bootstrap returned HTTP ${response.status}`)
      const body = JSON.parse(response.body)
      if (generation !== this.generation) throw new Error('Session changed during authentication')
      if (body.session_id && body.session_secret && body.expires_at) { this.save({ ...record, ...body }); this.pending = null; this.blocked = false; return true }
      let authUrl = body.auth_url || body.challenge_url
      let state = crypto.randomBytes(24).toString('base64url')
      if (!authUrl && body.challenge_id) {
        const challenge = new URL(this.endpoint(this.config.endpoints?.challenge || '/challenge'))
        const callback = new URL(this.config.callbackUrl || 'spotiflac://session-grant')
        callback.searchParams.set('cb_version', 'v2grant'); callback.searchParams.set('state', state)
        challenge.searchParams.set('id', body.challenge_id)
        challenge.searchParams.set('cb', callback.href)
        authUrl = challenge.href
      }
      const challenge = validateURL(authUrl, this.network.permissions)
      const nested = challenge.searchParams.get('cb') || challenge.searchParams.get('callback_url') || challenge.searchParams.get('redirect_uri')
      const nestedState = nested ? new URL(nested).searchParams.get('state') : ''
      state = challenge.searchParams.get('state') || nestedState || state
      if (!challenge.searchParams.get('state') && !nestedState) challenge.searchParams.set('state', state)
      this.pending = { url: challenge.href, state, createdAt: Date.now() }
      return false
    })().finally(() => { this.flight = null })
    return this.flight
  }
  async completeGrant(grant, signal) {
    grant ||= this.pendingGrant
    if (!grant) throw new Error('No pending verification grant')
    if (this.exchange) return this.exchange
    this.exchange = (async () => {
      const generation = this.generation, record = this.record()
      const response = await this.network.jsonResponse(this.endpoint(this.config.endpoints?.exchange || '/session/exchange'), {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant, install_id: record.install_id, app_version: this.config.appVersion || 'ext-1.0', platform: this.config.platform || 'extension' }),
      })
      if (!response.ok) throw new Error(`Session exchange returned HTTP ${response.status}`)
      const body = JSON.parse(response.body)
      if (!body.session_id || !body.session_secret || !body.expires_at) throw new Error('Session exchange omitted its session fields')
      if (generation !== this.generation) throw new Error('Session changed during authentication')
      this.save({ ...record, session_id: body.session_id, session_secret: body.session_secret, expires_at: body.expires_at })
      this.pending = null; this.pendingGrant = null; this.blocked = false
      return { success: true }
    })().finally(() => { this.exchange = null })
    return this.exchange
  }
  async callback(raw, signal) {
    let url = new URL(raw)
    if (url.searchParams.get('cb')) url = new URL(url.searchParams.get('cb'))
    const expected = new URL(this.config.callbackUrl || 'spotiflac://session-grant')
    if (url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname || !this.pending || Date.now() - this.pending.createdAt > 180000 || !url.searchParams.get('state') || url.searchParams.get('state') !== this.pending.state) throw new Error('Invalid or expired verification callback')
    this.pendingGrant = url.searchParams.get('grant') || url.searchParams.get('code')
    return this.completeGrant(undefined, signal)
  }
  async refresh(record, signal) {
    if (!this.config.endpoints?.refresh || Date.parse(record.expires_at) - Date.now() > 3600000) return
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      const generation = this.generation
      const response = await this.request(record, 'POST', this.config.endpoints.refresh, JSON.stringify({ install_id: record.install_id }), {}, signal)
      if (!response.ok) return
      const next = JSON.parse(response.body)
      if (generation === this.generation && this.record().session_id === record.session_id) this.save({ ...record, ...Object.fromEntries(['session_id', 'session_secret', 'expires_at'].filter(k => next[k]).map(k => [k,next[k]])) })
    })().finally(() => { this.refreshing = null })
    return this.refreshing
  }
  request(record, method, path, body, headers, signal) {
    const url = this.endpoint(path)
    return this.network.jsonResponse(url, { method: method.toUpperCase(), body, signal, headers: { 'Content-Type': 'application/json', ...headers, ...signedHeaders(this.config, record, method, url, body) } })
  }
  async signedFetch(method, path, body = '', headers = {}, signal) {
    try {
      let record = this.record()
      if (!this.usable(record) || this.blocked) {
        if (!await this.bootstrap(signal)) return this.verification()
        record = this.record()
      }
      await this.refresh(record, signal).catch(() => {})
      record = this.record()
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await this.request(record, method, path, body, headers, signal)
        let contract = {}; try { contract = JSON.parse(response.body) } catch {}
        const code = String(contract.code || '').toUpperCase()
        if (response.status === 503 && contract.origin === 'provider' && code === 'PROVIDER_UNAVAILABLE' && contract.retryable && contract.retry_mode === 'same_operation' && attempt < 2) {
          await new Promise((resolve,reject) => { const timer = setTimeout(resolve, Math.min(120, Math.max(1, Number(contract.retry_after_seconds) || 1)) * 1000); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Cancelled')) }, { once: true }) }); continue
        }
        const reset = response.status === 401 && contract.origin === 'gateway' && code === 'SESSION_INVALID' && contract.action === 'bootstrap_session'
        const verify = response.status === 428 && contract.origin === 'gateway' && code === 'VERIFY_REQUIRED' && contract.action === 'verify'
        if ((reset || verify) && attempt < 1) {
          if (reset) this.clear(); else this.blocked = true
          if (!await this.bootstrap(signal)) return this.verification()
          record = this.record(); continue
        }
        return { ...response, ...(code ? { error_code: code, error_origin: contract.origin, error_action: contract.action, retry_after_seconds: contract.retry_after_seconds || 0 } : {}) }
      }
    } catch (error) { return { ok: false, error: error.message } }
  }
}
module.exports = { SignedSession, signedHeaders }
