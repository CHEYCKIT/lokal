const dns = require('dns').promises
const net = require('net')

function publicIPv4(address) {
  const octets = String(address).split('.').map(Number)
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = octets
  return !(
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function publicIPv6(address) {
  const value = String(address).toLowerCase().split('%')[0]
  if (value === '::' || value === '::1') return false
  if (/^(?:fc|fd)[0-9a-f]{2}:/.test(value)) return false // unique-local
  if (/^fe[89ab][0-9a-f]:/.test(value)) return false // link-local
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice('::ffff:'.length)
    if (net.isIP(mapped) === 4) return publicIPv4(mapped)
    const parts = mapped.split(':')
    if (parts.length === 2 && parts.every(part => /^[0-9a-f]{1,4}$/.test(part))) {
      const high = parseInt(parts[0], 16), low = parseInt(parts[1], 16)
      return publicIPv4([high >> 8, high & 255, low >> 8, low & 255].join('.'))
    }
  }
  // Reject non-global special IPv6 ranges; global unicast starts in 2000::/3.
  return /^2[0-9a-f]{3}:/.test(value) || /^3[0-9a-f]{3}:/.test(value)
}

function publicAddress(address) {
  const family = net.isIP(address)
  return family === 4 ? publicIPv4(address) : family === 6 ? publicIPv6(address) : false
}

/**
 * Only permit public HTTP(S) targets for server-side requests. Tests that
 * inject a fake fetch skip DNS, but still reject literal private addresses.
 */
async function isPublicHttpUrl(value, { resolveDns = true, lookup = dns.lookup } = {}) {
  let url
  try { url = new URL(String(value || '').trim()) } catch { return false }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') return false
  if (net.isIP(host)) return publicAddress(host)
  if (!resolveDns) return true
  try {
    const records = await lookup(host, { all: true, verbatim: true })
    return records.length > 0 && records.every(record => publicAddress(record.address))
  } catch { return false }
}

module.exports = { isPublicHttpUrl, publicAddress }
