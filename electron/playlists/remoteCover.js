// Covers taken from the web: a saved YouTube Music mix keeps the mix's own
// cover as the playlist photo. https only, never this computer or the local
// network, images only, 10 MB at most.

const net = require('net')

const MAX_BYTES = 10 * 1024 * 1024

/** `value` as a URL that's safe to fetch an image from, or null. */
function httpsImageURL(value) {
  let url
  try { url = new URL(String(value || '')) } catch { return null }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (net.isIP(host) || host === 'localhost' || /\.(?:localhost|local|internal|lan|home)$/.test(host) || !host.includes('.')) return null
  return url
}

/** The image at `value` as a data: URL, or null if it isn't one. */
async function fetchCoverData(value, { timeout = 8000 } = {}) {
  const url = httpsImageURL(value)
  if (!url) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, { redirect: 'error', signal: controller.signal })
    const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!response.ok || !response.body || !/^image\/(?:jpeg|png|webp)$/.test(type)) return null
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      total += chunk.byteLength
      if (total > MAX_BYTES) { controller.abort(); return null }
      chunks.push(chunk)
    }
    if (!total) return null
    return `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { httpsImageURL, fetchCoverData }
