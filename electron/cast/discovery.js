// Cast devices on the network, found by mDNS: each announces itself as
// "<something>._googlecast._tcp.local" with an SRV record (host and port),
// a TXT record (its name, model, id and what it can do) and an address.
//
// Started the first time the Cast menu opens, not with the app: listening
// for multicast is what can make Windows ask about its firewall, and nobody
// who never casts should be asked. Once started it keeps listening for the
// session (asking now and then); while the menu is open it asks every few
// seconds, so a device that was just switched on shows up quickly.

const { EventEmitter } = require('events')

const SERVICE = '_googlecast._tcp.local'
const PASSIVE_EVERY_MS = 60000
const ACTIVE_EVERY_MS = 3000
const FORGET_AFTER_MS = 4 * 60 * 1000 // not heard of for this long: gone

// TXT "ca": what the device can do (a bit field).
const CAN = { videoOut: 1, audioOut: 4, group: 32 }

function txtMap(record) {
  const map = {}
  for (const entry of Array.isArray(record?.data) ? record.data : [record?.data]) {
    const text = Buffer.isBuffer(entry) ? entry.toString('utf8') : String(entry || '')
    const at = text.indexOf('=')
    if (at > 0) map[text.slice(0, at).toLowerCase()] = text.slice(at + 1)
  }
  return map
}

/** What a device is, from its TXT record: 'tv' (has a screen), 'group' or 'speaker'. */
function kindOf({ ca, md, port }) {
  const caps = Number(ca) || 0
  if (caps & CAN.group || /group/i.test(md || '') || (port && port !== 8009)) return 'group'
  if (caps & CAN.videoOut) return 'tv'
  return 'speaker'
}

/**
 * Folds one mDNS response's records into `known` (instance name -> partial
 * device) and returns the instances it touched. Pure, for the tests.
 */
function absorb(known, records) {
  const touched = new Set()
  const addresses = new Map() // host name -> IPv4
  for (const record of records) {
    if (record.type === 'A' && record.name) addresses.set(record.name.toLowerCase(), record.data)
  }
  for (const record of records) {
    const name = String(record.name || '')
    if (record.type === 'PTR' && name.toLowerCase() === SERVICE) {
      const instance = String(record.data)
      if (!known.has(instance)) known.set(instance, {})
      touched.add(instance)
    } else if (record.type === 'SRV' && name.toLowerCase().endsWith(SERVICE)) {
      const entry = known.get(name) || {}
      entry.target = String(record.data?.target || '').toLowerCase()
      entry.port = record.data?.port || 8009
      known.set(name, entry)
      touched.add(name)
    } else if (record.type === 'TXT' && name.toLowerCase().endsWith(SERVICE)) {
      const entry = known.get(name) || {}
      entry.txt = txtMap(record)
      known.set(name, entry)
      touched.add(name)
    }
  }
  for (const [instance, entry] of known) {
    if (entry.target && addresses.has(entry.target)) { entry.host = addresses.get(entry.target); touched.add(instance) }
  }
  return touched
}

/** A device the rest of Lokal uses, once its name, address and port are all known. */
function deviceOf(instance, entry) {
  const txt = entry.txt || {}
  if (!entry.host || !entry.port || !txt.fn) return null
  const caps = Number(txt.ca) || 0
  // A device that can't play sound (a camera, an input) is no use for music.
  if (txt.ca != null && !(caps & CAN.audioOut) && !(caps & CAN.group)) return null
  return {
    id: txt.id || instance,
    name: txt.fn,
    model: txt.md || '',
    host: entry.host,
    port: entry.port,
    kind: kindOf({ ca: txt.ca, md: txt.md, port: entry.port }),
  }
}

/**
 * Events: 'change' (devices). `mdns`: a multicast-dns instance factory (the
 * tests pass a pretend one).
 */
class CastDiscovery extends EventEmitter {
  constructor({ mdns = () => require('../network/mdns').acquireMdns(), now = Date.now, log = () => {} } = {}) {
    super()
    this.createMdns = mdns
    this.now = now
    this.log = log
    this.known = new Map() // instance -> partial device
    this.devices = new Map() // id -> device (with lastSeen)
    this.manual = new Map() // id -> device added by address
    this.mdns = null
    this.timer = null
    this.activeUntil = 0
  }

  /** Starts listening (once). Throws nothing: a network that can't be listened on just finds nothing. */
  start() {
    if (this.mdns) return
    try {
      this.mdns = this.createMdns()
      this.mdns.on('response', response => this.onResponse(response))
      this.mdns.on('error', error => this.log(`mDNS: ${error?.message || error}`))
    } catch (error) {
      this.log(`mDNS unavailable: ${error?.message || error}`)
      this.mdns = null
      return
    }
    this.ask()
    this.schedule()
  }

  /** Asks every few seconds for the next `ms` (the menu is open), then goes back to now and then. */
  scan(ms = 15000) {
    this.start()
    this.activeUntil = this.now() + ms
    this.ask()
    this.schedule()
  }

  schedule() {
    clearTimeout(this.timer)
    if (!this.mdns) return
    const active = this.now() < this.activeUntil
    this.timer = setTimeout(() => { this.ask(); this.expire(); this.schedule() }, active ? ACTIVE_EVERY_MS : PASSIVE_EVERY_MS)
    this.timer.unref?.()
  }

  ask() {
    try { this.mdns?.query({ questions: [{ name: SERVICE, type: 'PTR' }] }) } catch (error) { this.log(`mDNS query: ${error?.message || error}`) }
  }

  onResponse(response) {
    const records = [...(response?.answers || []), ...(response?.additionals || [])]
    const touched = absorb(this.known, records)
    let changed = false
    for (const instance of touched) {
      const entry = this.known.get(instance)
      const device = deviceOf(instance, entry)
      if (!device) {
        // Half an answer (no address or no TXT yet): ask for the rest of it.
        if (entry && (!entry.txt || !entry.port)) try { this.mdns?.query({ questions: [{ name: instance, type: 'SRV' }, { name: instance, type: 'TXT' }] }) } catch {}
        else if (entry?.target && !entry.host) try { this.mdns?.query({ questions: [{ name: entry.target, type: 'A' }] }) } catch {}
        continue
      }
      const before = this.devices.get(device.id)
      const same = before && before.name === device.name && before.host === device.host && before.port === device.port
      this.devices.set(device.id, { ...device, lastSeen: this.now() })
      if (!same) changed = true
    }
    if (changed) this.emit('change', this.list())
  }

  expire() {
    let changed = false
    for (const [id, device] of this.devices) {
      if (this.now() - device.lastSeen > FORGET_AFTER_MS) { this.devices.delete(id); changed = true }
    }
    if (changed) this.emit('change', this.list())
  }

  /** A device added by its address (a network where discovery is blocked). */
  addManual(device) {
    this.manual.set(device.id, { ...device, manual: true })
    this.emit('change', this.list())
  }

  removeManual(id) {
    if (this.manual.delete(id)) this.emit('change', this.list())
  }

  /** Devices, TVs first, then by name. */
  list() {
    const all = new Map(this.manual)
    for (const [id, device] of this.devices) all.set(id, { ...device })
    const order = { tv: 0, speaker: 1, group: 2 }
    return [...all.values()]
      .map(({ lastSeen, ...device }) => device)
      .sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3) || a.name.localeCompare(b.name))
  }

  get(id) { return this.devices.get(id) || this.manual.get(id) || null }

  stop() {
    clearTimeout(this.timer)
    try { this.mdns?.destroy() } catch {}
    this.mdns = null
  }
}

/**
 * A device by its address, for networks where it can't be found: its name
 * from the device's own setup page when it answers, else the address.
 */
async function probeAddress(host, { fetchImpl = (...args) => fetch(...args), timeoutMs = 2500 } = {}) {
  const address = String(host || '').trim()
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(address)) throw new Error('Enter the device\'s IP address, like 192.168.1.40')
  let name = address
  let model = ''
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`http://${address}:8008/setup/eureka_info?params=name,device_info`, { signal: controller.signal })
    const info = await res.json()
    if (info?.name) name = String(info.name)
    model = String(info?.device_info?.model_name || '')
  } catch {} finally { clearTimeout(timer) }
  return { id: `ip:${address}`, name, model, host: address, port: 8009, kind: 'tv' }
}

module.exports = { CastDiscovery, absorb, deviceOf, kindOf, txtMap, probeAddress, SERVICE, CAN }
