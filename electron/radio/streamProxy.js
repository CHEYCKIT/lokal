// Proxy Internet radio through Electron's main process so the renderer does not
// depend on each station granting cross-origin access to ICY metadata streams.
// Redirects are followed one hop at a time and each target is checked to avoid
// turning a remote catalogue into a request to localhost or private network hosts.

const { isPublicHttpUrl } = require('../online/publicUrl')

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Icy-MetaData, Range',
  'access-control-expose-headers': [
    'Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges',
    'Icy-MetaInt', 'Icy-Br', 'Icy-Name', 'Icy-Description', 'Icy-Genre',
    'Icy-Url', 'Icy-Pub', 'Icy-Notice1', 'Icy-Notice2', 'Ice-Audio-Info',
  ].join(', '),
  'cache-control': 'no-store',
}

const RESPONSE_HEADERS = [
  'content-type', 'content-length', 'content-range', 'accept-ranges',
  'icy-metaint', 'icy-br', 'icy-name', 'icy-description', 'icy-genre',
  'icy-url', 'icy-pub', 'icy-notice1', 'icy-notice2', 'ice-audio-info',
]
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const CONNECT_TIMEOUT_MS = 15000

function parseRadioStreamTarget(value) {
  try {
    const url = new URL(String(value || '').trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

function errorResponse(message, status) {
  return new Response(message, {
    status,
    headers: new Headers({ ...CORS_HEADERS, 'content-type': 'text/plain; charset=utf-8' }),
  })
}

/**
 * Proxies one live radio stream. fetchImpl must perform a single HTTP request
 * and expose redirects rather than following them automatically.
 */
async function proxyRadioStream(request, rawTarget, {
  fetchImpl,
  validateUrl = isPublicHttpUrl,
  maxRedirects = 5,
} = {}) {
  const method = String(request?.method || 'GET').toUpperCase()
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (method !== 'GET' && method !== 'HEAD') return errorResponse('Method not allowed', 405)
  if (typeof fetchImpl !== 'function') return errorResponse('Radio transport is unavailable', 502)

  let target = parseRadioStreamTarget(rawTarget)
  if (!target) return errorResponse('Invalid radio stream URL', 400)

  const abortController = new AbortController()
  const requestSignal = request?.signal
  const abortFromRequest = () => abortController.abort()
  requestSignal?.addEventListener?.('abort', abortFromRequest, { once: true })
  if (requestSignal?.aborted) abortController.abort()

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    requestSignal?.removeEventListener?.('abort', abortFromRequest)
  }

  try {
    let upstream
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
      if (abortController.signal.aborted) {
        cleanup()
        return errorResponse('Radio stream request was cancelled', 502)
      }
      if (!(await validateUrl(target))) {
        cleanup()
        return errorResponse('Radio stream host is not public', 403)
      }

      const requestHeaders = new Headers()
      const range = request?.headers?.get?.('range')
      const icyMetadata = request?.headers?.get?.('icy-metadata')
      if (range) requestHeaders.set('Range', range)
      if (icyMetadata === '1') requestHeaders.set('Icy-MetaData', '1')

      // Bound time-to-first-response, but do not time out the live stream after headers arrive.
      const connectTimer = setTimeout(() => abortController.abort(), CONNECT_TIMEOUT_MS)
      try {
        upstream = await fetchImpl(target, {
          method,
          headers: requestHeaders,
          signal: abortController.signal,
          redirect: 'manual',
        })
      } finally {
        clearTimeout(connectTimer)
      }

      if (!REDIRECT_STATUSES.has(upstream.status)) break
      const location = upstream.headers?.get?.('location')
      try { await upstream.body?.cancel?.() } catch {}
      if (!location || redirectCount === maxRedirects) {
        cleanup()
        return errorResponse('The radio stream redirected too many times', 502)
      }
      try {
        target = new URL(location, target).href
      } catch {
        cleanup()
        return errorResponse('The radio stream returned an invalid redirect', 502)
      }
    }

    const headers = new Headers(CORS_HEADERS)
    for (const name of RESPONSE_HEADERS) {
      const value = upstream?.headers?.get?.(name)
      if (value != null) {
        try { headers.set(name, value) } catch {}
      }
    }

    if (method === 'HEAD' || [204, 205, 304].includes(upstream.status) || !upstream.body) {
      try { await upstream.body?.cancel?.() } catch {}
      cleanup()
      return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers })
    }

    const reader = upstream.body.getReader()
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            cleanup()
            controller.close()
          } else {
            controller.enqueue(value)
          }
        } catch (error) {
          cleanup()
          controller.error(error)
        }
      },
      async cancel(reason) {
        abortController.abort()
        try { await reader.cancel(reason) } catch {}
        cleanup()
      },
    }, { highWaterMark: 0 })

    return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers })
  } catch (error) {
    cleanup()
    return errorResponse(abortController.signal.aborted ? 'Radio stream request was cancelled' : String(error?.message || 'Radio stream request failed'), 502)
  }
}

module.exports = { parseRadioStreamTarget, proxyRadioStream }
