// One multicast socket shared by Cast discovery and the opt-in desktop link.
let socket
let users = 0
function acquireMdns() {
  socket ||= require('multicast-dns')()
  const shared = socket
  const listeners = []
  users++
  let closed = false
  return {
    on(event, listener) { shared.on(event, listener); listeners.push([event, listener]); return this },
    query(packet) { shared.query(packet) },
    respond(packet) { shared.respond(packet) },
    destroy() {
      if (closed) return
      closed = true
      for (const [event, listener] of listeners) shared.removeListener(event, listener)
      if (--users === 0) { shared.destroy(); socket = null }
    },
  }
}
module.exports = { acquireMdns }
