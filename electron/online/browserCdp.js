const { EventEmitter } = require('events')

/** A main-process-only connection to the app's own browser on loopback. */
async function connectBrowser(url, { WebSocketImpl = globalThis.WebSocket, timeoutMs = 10000 } = {}) {
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1') throw new Error('Unexpected browser connection endpoint.')
  const socket = new WebSocketImpl(url)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Could not connect to the sign-in browser.')) }, timeoutMs)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to the sign-in browser.')) }, { once: true })
  })
  const events = new EventEmitter()
  const pending = new Map()
  let id = 0
  let closed = false
  socket.addEventListener('message', event => {
    let message
    try { message = JSON.parse(event.data) } catch { return }
    const request = pending.get(message.id)
    if (request) {
      pending.delete(message.id)
      clearTimeout(request.timer)
      if (message.error) request.reject(new Error(message.error.message || 'Browser request failed.'))
      else request.resolve(message.result || {})
    } else if (message.method) events.emit(message.method, message.params || {}, message.sessionId)
  })
  socket.addEventListener('close', () => {
    closed = true
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('The sign-in browser was closed.')) }
    pending.clear()
    events.emit('closed')
  })
  return Object.assign(events, {
    send(method, params = {}, sessionId) {
      if (closed) return Promise.reject(new Error('The sign-in browser was closed.'))
      return new Promise((resolve, reject) => {
        const requestId = ++id
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Sign-in browser request timed out.')) }, timeoutMs)
        pending.set(requestId, { resolve, reject, timer })
        try { socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) })) }
        catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error) }
      })
    },
    close: () => socket.close(),
  })
}

module.exports = { connectBrowser }
