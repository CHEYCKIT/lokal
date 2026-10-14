// A fetch-compatible, one-hop transport for addon media URLs.
//
// Electron net.fetch() rejects redirect: 'manual' with "Redirect was cancelled"
// instead of returning the 3xx response. addons.fetchChecked() deliberately
// handles one redirect at a time so it can validate every target before
// requesting it. net.request() exposes the redirect event needed for that.
const { Readable } = require('node:stream')

function responseHeaders(raw = {}) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(raw)) {
    if (value == null) continue
    try { headers.set(name, Array.isArray(value) ? value.join(', ') : String(value)) } catch {}
  }
  return headers
}

function abortError() {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

/**
 * Perform exactly one HTTP request, returning a normal Response for either
 * the response or a redirect. Do not follow redirects here: the caller must
 * inspect Location and validate it before requesting the next hop.
 */
function netFetch(net, input, init = {}) {
  if (!net?.request) return Promise.reject(new Error('Electron net.request is unavailable'))
  if (init.signal?.aborted) return Promise.reject(abortError())

  const headers = Object.fromEntries(new Headers(init.headers || {}).entries())
  return new Promise((resolve, reject) => {
    let settled = false
    let request
    let responseMessage = null
    let signalListener = null

    const removeSignalListener = () => {
      if (signalListener) init.signal?.removeEventListener?.('abort', signalListener)
      signalListener = null
    }
    const rejectBeforeResponse = error => {
      if (settled) return
      settled = true
      removeSignalListener()
      reject(error)
    }
    const resolveRedirect = (status, rawHeaders) => {
      if (settled) return
      settled = true
      removeSignalListener()
      resolve(new Response(null, { status, headers: responseHeaders(rawHeaders) }))
    }

    try {
      request = net.request({
        url: String(input),
        method: String(init.method || 'GET').toUpperCase(),
        headers,
        redirect: 'manual',
      })
    } catch (error) {
      rejectBeforeResponse(error)
      return
    }

    signalListener = () => {
      const error = abortError()
      const hadResponse = settled
      settled = true
      removeSignalListener()
      try { request.abort() } catch {}
      try { responseMessage?.destroy(error) } catch {}
      if (!hadResponse) reject(error)
    }
    init.signal?.addEventListener?.('abort', signalListener, { once: true })
    // Cover an abort racing with request creation/listener registration.
    if (init.signal?.aborted) {
      signalListener()
      return
    }

    request.on('redirect', (statusCode, _method, _redirectUrl, rawHeaders) => {
      // In manual mode Electron cancels the underlying request after this
      // callback unless followRedirect() is called synchronously. That is
      // intentional: fetchChecked will validate Location and start the next hop.
      resolveRedirect(statusCode, rawHeaders)
    })

    request.on('response', incoming => {
      if (settled) { incoming.destroy(); return }
      settled = true
      responseMessage = incoming
      const status = Number(incoming.statusCode) || 200
      const headers = responseHeaders(incoming.headers)
      const noBody = status === 204 || status === 205 || status === 304
      const body = noBody ? null : Readable.toWeb(incoming)

      const cleanup = () => removeSignalListener()
      incoming.once('end', cleanup)
      incoming.once('close', cleanup)
      incoming.once('error', cleanup)
      if (noBody) incoming.resume()

      resolve(new Response(body, { status, headers }))
    })

    request.on('error', error => rejectBeforeResponse(error))
    // Electron can emit close before redirect for a manually handled 3xx.
    // Do not treat close alone as failure: the redirect/error events, the
    // caller's abort signal, or its response timeout settle the request.

    try { request.end() } catch (error) { rejectBeforeResponse(error) }
  })
}

module.exports = { netFetch }
