const { EventEmitter } = require('events')

/** CDP over the app-owned child's private descriptors; no listening socket. */
async function connectBrowser(browserProcess, { timeoutMs = 10000 } = {}) {
  const writer = browserProcess?.stdio?.[3], reader = browserProcess?.stdio?.[4]
  if (!writer?.write || !reader?.setEncoding || writer.destroyed || reader.destroyed) throw new Error('The sign-in browser debugging pipe is unavailable.')
  const events = new EventEmitter()
  const pending = new Map()
  let id = 0
  let closed = false
  let buffer = ''
  const received = chunk => {
    buffer += chunk
    let end
    while (!closed && (end = buffer.indexOf('\0')) !== -1) {
      const text = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      let message
      try { message = JSON.parse(text) } catch { continue }
      const request = pending.get(message.id)
      if (request) {
        pending.delete(message.id)
        clearTimeout(request.timer)
        if (message.error) request.reject(new Error(message.error.message || 'Browser request failed.'))
        else request.resolve(message.result || {})
      } else if (message.method) events.emit(message.method, message.params || {}, message.sessionId)
    }
  }
  const disconnected = () => {
    if (closed) return
    closed = true
    buffer = ''
    reader.removeListener('data', received)
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('The sign-in browser was closed.')) }
    pending.clear()
    events.emit('closed')
  }
  reader.setEncoding('utf8')
  reader.on('data', received)
  reader.once('end', disconnected)
  reader.once('close', disconnected)
  reader.on('error', disconnected)
  writer.once('close', disconnected)
  writer.on('error', disconnected)
  browserProcess.once('exit', disconnected)
  browserProcess.once('error', disconnected)
  return Object.assign(events, {
    send(method, params = {}, sessionId) {
      if (closed) return Promise.reject(new Error('The sign-in browser was closed.'))
      return new Promise((resolve, reject) => {
        const requestId = ++id
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Sign-in browser request timed out.')) }, timeoutMs)
        pending.set(requestId, { resolve, reject, timer })
        try { writer.write(`${JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) })}\0`, error => { if (error) disconnected() }) }
        catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error) }
      })
    },
    close: () => { disconnected(); writer.destroy(); reader.destroy() },
  })
}

module.exports = { connectBrowser }
