// Online radio: the user's station catalogue, a JSON file at a URL they give.
// Only the parsed data is kept (in settings), never the file. Pure functions
// apart from fetchCatalog, so the web server and the tests share them.

const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15000

const API_TYPES = {
  azuracast: ['url'],
  radiorecord: ['station'],
  lautfm: ['station'],
  json: ['url'],
}

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  try { return ['http:', 'https:'].includes(new URL(value.trim()).protocol) } catch { return false }
}

/** Line and column (1-based) of a character offset in `text`. */
function lineColumn(text, position) {
  const before = text.slice(0, position)
  const lines = before.split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

/** A JSON.parse failure, with where it happened and the text around it. */
function syntaxError(text, error) {
  const message = String(error?.message || error)
  let line = null
  let column = null
  const lc = message.match(/line (\d+) column (\d+)/i)
  const pos = message.match(/position (\d+)/i)
  if (lc) { line = Number(lc[1]); column = Number(lc[2]) }
  else if (pos) ({ line, column } = lineColumn(text, Number(pos[1])))
  let excerpt = ''
  if (line) {
    const lines = text.split('\n')
    const from = Math.max(0, line - 3)
    excerpt = lines.slice(from, line + 1).map((content, i) => `${String(from + i + 1).padStart(4)} | ${content.replace(/\r$/, '')}`).join('\n')
  }
  return { path: '', code: 'json-syntax', detail: message, line, column, excerpt }
}

function checkOptionalString(errors, station, field, path) {
  if (station[field] == null) return undefined
  if (typeof station[field] !== 'string') { errors.push({ path: `${path}.${field}`, code: 'not-string', field }); return undefined }
  return station[field].trim() || undefined
}

function parseApi(errors, api, path) {
  if (api == null) return undefined
  if (!isObject(api)) { errors.push({ path, code: 'api-not-object' }); return undefined }
  const type = typeof api.type === 'string' ? api.type.trim().toLowerCase() : ''
  if (!type) { errors.push({ path: `${path}.type`, code: 'required-missing', field: 'type' }); return undefined }
  if (!API_TYPES[type]) { errors.push({ path: `${path}.type`, code: 'api-type-unknown', detail: type, allowed: Object.keys(API_TYPES) }); return undefined }
  const out = { type }
  let ok = true
  for (const field of API_TYPES[type]) {
    const value = api[field]
    if (value == null || (typeof value === 'string' && !value.trim())) { errors.push({ path: `${path}.${field}`, code: 'required-missing', field }); ok = false; continue }
    if (field === 'url' && !isHttpUrl(value)) { errors.push({ path: `${path}.${field}`, code: 'bad-url', field }); ok = false; continue }
    if (typeof value !== 'string' && typeof value !== 'number') { errors.push({ path: `${path}.${field}`, code: 'not-string', field }); ok = false; continue }
    out[field] = String(value).trim()
  }
  if (type === 'azuracast' && api.station != null) out.station = String(api.station).trim()
  if (type === 'json') {
    for (const field of ['artist', 'title', 'text', 'cover', 'album', 'lyrics', 'duration', 'elapsed']) {
      if (api[field] == null) continue
      if (typeof api[field] !== 'string') { errors.push({ path: `${path}.${field}`, code: 'not-string', field }); ok = false; continue }
      out[field] = api[field].trim()
    }
    if (!out.text && !(out.artist && out.title)) {
      errors.push({ path, code: 'api-json-fields' })
      ok = false
    }
  }
  return ok ? out : undefined
}

/** A short, stable id for a station: its place and its stream. */
function stationId(index, url) {
  let hash = 0
  for (const char of url) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0
  return `station:${index}:${(hash >>> 0).toString(36)}`
}

/**
 * The catalogue in `text`: { ok: true, catalog } or { ok: false, errors }.
 * Every problem is reported at once, each with the path of the field.
 * Required: stations[], and each station's title and url. Optional: genre,
 * description, history, icon, api. Unknown fields are ignored.
 */
function parseCatalog(text) {
  const source = String(text ?? '').replace(/^﻿/, '')
  if (!source.trim()) return { ok: false, errors: [{ path: '', code: 'empty' }] }
  let data
  try { data = JSON.parse(source) } catch (error) { return { ok: false, errors: [syntaxError(source, error)] } }
  if (!isObject(data)) return { ok: false, errors: [{ path: '', code: 'root-not-object' }] }
  if (data.stations == null) return { ok: false, errors: [{ path: 'stations', code: 'required-missing', field: 'stations' }] }
  if (!Array.isArray(data.stations)) return { ok: false, errors: [{ path: 'stations', code: 'not-array', field: 'stations' }] }

  const errors = []
  const stations = []
  data.stations.forEach((station, index) => {
    const path = `stations[${index}]`
    if (!isObject(station)) { errors.push({ path, code: 'station-not-object' }); return }
    const before = errors.length
    let title
    if (station.title == null || (typeof station.title === 'string' && !station.title.trim())) errors.push({ path: `${path}.title`, code: 'required-missing', field: 'title' })
    else if (typeof station.title !== 'string') errors.push({ path: `${path}.title`, code: 'not-string', field: 'title' })
    else title = station.title.trim()
    let url
    if (station.url == null || (typeof station.url === 'string' && !station.url.trim())) errors.push({ path: `${path}.url`, code: 'required-missing', field: 'url' })
    else if (!isHttpUrl(station.url)) errors.push({ path: `${path}.url`, code: 'bad-url', field: 'url' })
    else url = station.url.trim()
    const genre = checkOptionalString(errors, station, 'genre', path)
    const description = checkOptionalString(errors, station, 'description', path)
    const history = checkOptionalString(errors, station, 'history', path)
    let icon = checkOptionalString(errors, station, 'icon', path)
    if (icon && !isHttpUrl(icon)) { errors.push({ path: `${path}.icon`, code: 'bad-url', field: 'icon' }); icon = undefined }
    const api = parseApi(errors, station.api, `${path}.api`)
    if (errors.length !== before) return
    stations.push({
      id: stationId(index, url), index, title, url,
      ...(genre ? { genre } : {}), ...(description ? { description } : {}), ...(history ? { history } : {}), ...(icon ? { icon } : {}), ...(api ? { api } : {}),
    })
  })
  if (errors.length) return { ok: false, errors }
  const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : ''
  return { ok: true, catalog: { version: Number(data.version) || 1, title, stations } }
}

/** Download the catalogue at `url`: { ok: true, text } or { ok: false, errors }. */
async function fetchCatalog(url, { fetchImpl = fetch, timeout = FETCH_TIMEOUT_MS } = {}) {
  if (!isHttpUrl(url)) return { ok: false, errors: [{ path: '', code: 'bad-catalog-url' }] }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetchImpl(String(url).trim(), { signal: controller.signal, headers: { 'Cache-Control': 'no-cache', Accept: 'application/json, text/plain, */*' } })
    if (!response.ok) return { ok: false, errors: [{ path: '', code: 'http', detail: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}` }] }
    const reader = response.body?.getReader?.()
    if (!reader) return { ok: true, text: await response.text() }
    const chunks = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_CATALOG_BYTES) { await reader.cancel().catch(() => {}); return { ok: false, errors: [{ path: '', code: 'too-large' }] } }
      chunks.push(Buffer.from(value))
    }
    return { ok: true, text: Buffer.concat(chunks, total).toString('utf8') }
  } catch (error) {
    return { ok: false, errors: [{ path: '', code: error?.name === 'AbortError' ? 'timeout' : 'network', detail: String(error?.cause?.message || error?.message || error) }] }
  } finally {
    clearTimeout(timer)
  }
}

/** Download and parse: { ok: true, catalog } or { ok: false, errors }. */
async function loadCatalog(url, options) {
  const fetched = await fetchCatalog(url, options)
  if (!fetched.ok) return fetched
  return parseCatalog(fetched.text)
}

module.exports = { parseCatalog, fetchCatalog, loadCatalog, isHttpUrl, API_TYPES, stationId }
