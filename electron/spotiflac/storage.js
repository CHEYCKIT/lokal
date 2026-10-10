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

class AddonStorage {
  constructor(root) { this.root = root }
  masterKey() {
    if (this.key) return this.key
    const file = path.join(this.root, 'master-key.json')
    let safeStorage
    if (process.versions.electron) {
      try { safeStorage = require('electron').safeStorage; if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') safeStorage = null } catch {}
    }
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (saved.kind === 'os') {
        if (!safeStorage) throw new Error('The operating-system addon credential vault is unavailable')
        this.key = Buffer.from(safeStorage.decryptString(Buffer.from(saved.value, 'base64')), 'base64')
      } else this.key = Buffer.from(saved.value, 'base64')
    } else {
      if (process.versions.electron && !safeStorage) throw new Error('Lokal needs an operating-system credential vault before installing this addon')
      this.key = crypto.randomBytes(32)
      atomicWrite(file, JSON.stringify(safeStorage
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
module.exports = { AddonStorage, seal, open, atomicWrite }
