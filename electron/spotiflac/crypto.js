const crypto = require('crypto')
const { seal, open } = require('./storage')

function bytes(value, encoding = 'base64') {
  if (value?.__bytes) return Buffer.from(value.__bytes)
  if (Array.isArray(value) || Buffer.isBuffer(value)) return Buffer.from(value)
  if (!['base64', 'base64url', 'hex', 'utf8', 'utf-8', 'binary', 'latin1', 'raw', 'bytes'].includes(encoding)) throw new Error('Unsupported binary encoding')
  if (encoding === 'hex' && (!/^(?:[a-f0-9]{2})*$/i.test(String(value)))) throw new Error('Invalid hex payload')
  return Buffer.from(String(value || ''), encoding === 'utf-8' ? 'utf8' : ['raw', 'bytes', 'binary'].includes(encoding) ? 'latin1' : encoding)
}
function encoded(value, encoding = 'base64') {
  return ['bytes', 'raw'].includes(encoding) ? { __bytes: [...value], __buffer: true } : value.toString(encoding === 'utf-8' ? 'utf8' : encoding)
}
let blowfishModule
async function transform(input, options, decrypt = true) {
  const algorithm = String(options.algorithm || '').toLowerCase()
  const mode = String(options.mode || 'cbc').toLowerCase()
  const key = bytes(options.key, options.keyEncoding || 'utf8')
  const iv = bytes(options.iv, options.ivEncoding || 'utf8')
  if (!['cbc', 'ctr'].includes(mode)) throw new Error('Unsupported block cipher mode')
  const size = algorithm === 'blowfish' ? 8 : 16
  if (iv.length !== size) throw new Error(`IV must be ${size} bytes`)
  if (algorithm === 'aes' || /^aes-(128|192|256)$/.test(algorithm)) {
    if (![16, 24, 32].includes(key.length) || (algorithm !== 'aes' && Number(algorithm.slice(4)) !== key.length * 8)) throw new Error('Invalid AES key length')
    const cipher = (decrypt ? crypto.createDecipheriv : crypto.createCipheriv)(`aes-${key.length * 8}-${mode}`, key, iv)
    cipher.setAutoPadding(mode === 'cbc' && options.padding === 'pkcs7')
    return Buffer.concat([cipher.update(input), cipher.final()])
  }
  if (algorithm !== 'blowfish' || key.length < 4 || key.length > 56) throw new Error('Unsupported cipher or invalid key length')
  const { Blowfish } = await (blowfishModule ||= import('egoroof-blowfish'))
  const cipher = new Blowfish(key)
  let data = Buffer.from(input)
  if (mode === 'cbc' && !decrypt && options.padding === 'pkcs7') {
    const count = size - data.length % size
    data = Buffer.concat([data, Buffer.alloc(count, count)])
  }
  if (mode === 'cbc' && data.length % size) throw new Error('CBC payload must be block aligned')
  const out = Buffer.alloc(data.length), chain = Buffer.from(iv)
  for (let offset = 0; offset < data.length; offset += size) {
    const block = Buffer.alloc(size); data.copy(block, 0, offset, offset + size)
    if (mode === 'cbc' && !decrypt) for (let i = 0; i < size; i++) block[i] ^= chain[i]
    const source = mode === 'ctr' ? chain : block
    const [left, right] = (mode === 'ctr' || !decrypt ? cipher._encryptBlock : cipher._decryptBlock).call(cipher, source.readUInt32BE(0), source.readUInt32BE(4))
    const result = Buffer.alloc(size); result.writeUInt32BE(left >>> 0); result.writeUInt32BE(right >>> 0, 4)
    if (mode === 'ctr') {
      for (let i = 0; i < size; i++) result[i] ^= block[i]
      for (let i = size - 1; i >= 0; i--) { chain[i] = (chain[i] + 1) & 255; if (chain[i]) break }
    } else {
      if (decrypt) for (let i = 0; i < size; i++) result[i] ^= chain[i]
      ;(decrypt ? block : result).copy(chain)
    }
    result.copy(out, offset, 0, Math.min(size, data.length - offset))
  }
  if (mode === 'cbc' && decrypt && options.padding === 'pkcs7') {
    const count = out.at(-1)
    if (!count || count > size || !out.subarray(-count).every(v => v === count)) throw new Error('Invalid cipher padding')
    return out.subarray(0, -count)
  }
  return out
}
async function block(operation, data, options = {}) {
  try {
    const input = bytes(data, options.inputEncoding || 'base64')
    if (input.length > 16 * 1024 * 1024) throw new Error('Binary payload exceeds 16 MB')
    if (operation === 'segments') {
      const output = Buffer.from(input)
      const size = options.algorithm === 'blowfish' ? 8 : 16
      if (!Array.isArray(options.segments)) throw new Error('Segments array is required')
      let count = 0
      for (const segment of options.segments) {
        const offset = Number(segment.offset), length = Number(segment.size)
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > output.length) throw new Error('Cipher segment is out of bounds')
        if (!length) continue
        const iv = bytes(segment.iv, options.ivEncoding || 'base64')
        if (iv.length > size) throw new Error('Segment IV is too long')
        const padded = Buffer.alloc(size); iv.copy(padded)
        const result = await transform(output.subarray(offset, offset + length), { ...options, algorithm: options.algorithm || 'aes', keyEncoding: options.keyEncoding || 'hex', mode: 'ctr', iv: padded }, true)
        result.copy(output, offset); count++
      }
      return { success: true, data: encoded(output, options.outputEncoding), segments_processed: count }
    }
    const output = await transform(input, options, operation === 'decrypt')
    return { success: true, data: encoded(output, options.outputEncoding), block_size: options.algorithm === 'blowfish' ? 8 : 16 }
  } catch (error) { return { success: false, error: error.message } }
}
function text(decrypt, value, key) {
  try {
    const derived = crypto.createHash('sha256').update(String(key)).digest()
    return { success: true, data: decrypt ? open(bytes(value), derived).toString() : seal(Buffer.from(String(value)), derived).toString('base64') }
  } catch (error) { return { success: false, error: error.message } }
}
module.exports = { bytes, encoded, transform, block, text }
