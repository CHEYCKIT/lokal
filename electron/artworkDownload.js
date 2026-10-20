const fs = require('fs-extra')
const path = require('path')
const crypto = require('crypto')
const http = require('http')
const https = require('https')
const { pipeline } = require('node:stream/promises')

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5

/** Download safely: stream errors reject the promise and incomplete files are never published. */
async function downloadImageWithTimeout(url, destination, timeoutMs = 5000, redirects = 0) {
  if (redirects > MAX_REDIRECTS) throw new Error('Too many artwork download redirects')
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('Invalid artwork URL') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Unsupported artwork URL protocol')

  await fs.ensureDir(path.dirname(destination))
  const tempPath = destination + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp'
  let request = null
  let response = null
  let timer = null
  try {
    const result = await new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        if (error) reject(error)
        else resolve(value)
      }
      const client = parsed.protocol === 'https:' ? https : http
      timer = setTimeout(() => {
        const error = new Error('Download timeout')
        request?.destroy(error)
        response?.destroy(error)
        finish(error)
      }, Math.max(1, Number(timeoutMs) || 5000))
      request = client.get(parsed, incoming => {
        response = incoming
        if (REDIRECT_CODES.has(incoming.statusCode) && incoming.headers.location) {
          incoming.resume()
          try {
            finish(null, { redirect: new URL(incoming.headers.location, parsed).toString() })
          } catch {
            finish(new Error('Invalid artwork redirect'))
          }
          return
        }
        if (incoming.statusCode !== 200) {
          incoming.resume()
          finish(new Error('Artwork request failed: HTTP ' + (incoming.statusCode || 'unknown')))
          return
        }
        finish(null, { response: incoming })
      })
      request.once('error', error => finish(error))
    })

    if (result.redirect) {
      clearTimeout(timer)
      timer = null
      return await downloadImageWithTimeout(result.redirect, destination, timeoutMs, redirects + 1)
    }

    response = result.response
    await pipeline(response, fs.createWriteStream(tempPath, { flags: 'wx' }))
    await fs.rename(tempPath, destination)
    return destination
  } catch (error) {
    throw new Error(error?.message || 'Could not download artwork')
  } finally {
    if (timer) clearTimeout(timer)
    await fs.remove(tempPath).catch(() => {})
  }
}

module.exports = { downloadImageWithTimeout }
