const os = require('os')
const { acquireMdns } = require('../network/mdns')
const SERVICE = '_lokal._tcp.local'
function advertise({ id, port, name = os.hostname(), version }) {
  const mdns = acquireMdns()
  const instance = `${id}.${SERVICE}`, host = `lokal-${id}.local`
  const records = ttl => {
    const answers = [
      { name: SERVICE, type: 'PTR', ttl, data: instance },
      { name: instance, type: 'SRV', ttl, data: { port, target: host, priority: 0, weight: 0 } },
      { name: instance, type: 'TXT', ttl, data: [`id=${id}`, `name=${name}`, `v=${version}`, 'proto=1'].map(value => Buffer.from(value)) },
    ]
    for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) if (!entry.internal && entry.family === 'IPv4' && !entry.address.startsWith('169.254.')) answers.push({ name: host, type: 'A', ttl, data: entry.address })
    return answers
  }
  mdns.on('query', packet => { if (packet.questions?.some(q => [SERVICE,instance,host].includes(q.name))) mdns.respond({ answers: records(120) }) })
  mdns.on('error', () => {})
  mdns.respond({ answers: records(120) })
  const timer = setInterval(() => mdns.respond({ answers: records(120) }), 60000)
  timer.unref?.()
  return () => { clearInterval(timer); try { mdns.respond({ answers: records(0) }) } finally { mdns.destroy() } }
}
module.exports = { advertise }
