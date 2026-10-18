const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function seal(bytes, key) {
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  return Buffer.concat([nonce, cipher.update(bytes), cipher.final(), cipher.getAuthTag()])
}
function open(bytes, key) {
  if (bytes.length < 28) throw new Error('Invalid encrypted addon data')
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
  cipher.setAuthTag(bytes.subarray(-16))
  return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()])
}
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${crypto.randomUUID()}.tmp`
  try { fs.writeFileSync(temp, data, { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file) }
  finally { try { fs.unlinkSync(temp) } catch {} }
}

// Shown to the user (the Addons page looks for "credential vault" to offer the reset).
const VAULT_UNAVAILABLE = 'Lokal cannot reach the operating-system credential vault (the Keychain on macOS), where it keeps the key for saved addon logins. Restart Lokal and try again. If it keeps happening, use "Reset saved logins" under Settings → Addons, then log in to your addons again.'

class AddonStorage {
  constructor(root, { platform = process.platform, vault = null } = {}) { this.root = root; this.platform = platform; this.vaultProvider = vault }
  /** Forgets the key and every saved login/setting file, so a new key is made on next use. */
  reset() {
    this.key = null
    fs.rmSync(path.join(this.root, 'master-key.json'), { force: true })
    this.discardEncrypted()
  }
  discardEncrypted() {
    const data = path.join(this.root, 'data')
    let namespaces = []
    try { namespaces = fs.readdirSync(data) } catch {}
    for (const namespace of namespaces) {
      let files = []
      try { files = fs.readdirSync(path.join(data, namespace)) } catch {}
      for (const file of files) if (file.endsWith('.enc')) fs.rmSync(path.join(data, namespace, file), { force: true })
    }
  }
  /** The OS vault (Electron safeStorage), or null when it can't be used. */
  vault() {
    if (this.vaultProvider) return this.vaultProvider()
    if (!process.versions.electron) return null
    try {
      const safeStorage = require('electron').safeStorage
      return !safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text' ? null : safeStorage
    } catch { return null }
  }
  masterKey() {
    if (this.key) return this.key
    const file = path.join(this.root, 'master-key.json')
    // macOS: Lokal is not signed with a Developer ID, so every update is a "new app" to
    // the Keychain, which then refuses the key of the previous build. The key therefore
    // lives in a private (0600) file there; Keychain keys made by older builds are moved
    // into it once, or replaced when they can no longer be read.
    const mac = this.platform === 'darwin'
    const safeStorage = this.vault()
    const keepLocally = key => atomicWrite(file, JSON.stringify({ kind: 'local', value: key.toString('base64') }))
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (saved.kind === 'os') {
        let key = null
        if (safeStorage) { try { key = Buffer.from(safeStorage.decryptString(Buffer.from(saved.value, 'base64')), 'base64') } catch {} }
        if (key?.length === 32) {
          this.key = key
          if (mac) keepLocally(key)
        } else if (mac) {
          // The old key is gone for good, and so is what it protected.
          console.warn('[SpotiFLAC] The Keychain key for saved addon logins is unreadable; starting with a new key (logins must be entered again).')
          try { fs.copyFileSync(file, path.join(this.root, 'master-key.os-backup.json')) } catch {}
          this.discardEncrypted()
          this.key = crypto.randomBytes(32)
          keepLocally(this.key)
        } else throw new Error(VAULT_UNAVAILABLE)
      } else this.key = Buffer.from(saved.value, 'base64')
    } else {
      if (!mac && process.versions.electron && !safeStorage) throw new Error(VAULT_UNAVAILABLE)
      this.key = crypto.randomBytes(32)
      atomicWrite(file, JSON.stringify(safeStorage && !mac
        ? { kind: 'os', value: safeStorage.encryptString(this.key.toString('base64')).toString('base64') }
        : { kind: 'local', value: this.key.toString('base64') }))
    }
    if (this.key.length !== 32) throw new Error('Invalid addon credential key')
    return this.key
  }
  file(namespace, purpose) {
    if (!/^[a-f0-9]{10,64}$/.test(namespace) || !/^[a-z]+$/.test(purpose)) throw new Error('Invalid addon storage namespace')
    return path.join(this.root, 'data', namespace, `${purpose}.${purpose === 'storage' ? 'json' : 'enc'}`)
  }
  derived(namespace, purpose) { return crypto.createHmac('sha256', this.masterKey()).update(`Lokal SpotiFLAC storage v1\0${purpose}\0${namespace}`).digest() }
  read(namespace, purpose) {
    const file = this.file(namespace, purpose)
    if (!fs.existsSync(file)) return Object.create(null)
    const bytes = fs.readFileSync(file)
    const value = JSON.parse((purpose === 'storage' ? bytes : open(bytes, this.derived(namespace, purpose))).toString())
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid addon storage record')
    return value
  }
  write(namespace, purpose, value) {
    const bytes = Buffer.from(JSON.stringify(value))
    if (bytes.length > 5 * 1024 * 1024) throw new Error('Addon storage exceeds 5 MB')
    atomicWrite(this.file(namespace, purpose), purpose === 'storage' ? bytes : seal(bytes, this.derived(namespace, purpose)))
  }
  update(namespace, purpose, key, value, remove = false) {
    const current = this.read(namespace, purpose)
    if (remove) delete current[key]
    else Object.defineProperty(current, key, { value, enumerable: true, writable: true, configurable: true })
    this.write(namespace, purpose, current)
    return { success: true }
  }
}
module.exports = { VAULT_UNAVAILABLE, AddonStorage, seal, open, atomicWrite }
