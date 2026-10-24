'use strict'

// Keep successful executable checks across app restarts. A path is trusted only
// while its on-disk fingerprint is unchanged; upgrades force a new validation.
const fs = require('node:fs')
const path = require('node:path')

function createToolHealthCache(filename) {
  let records = null
  function load() {
    if (records) return records
    try {
      const value = JSON.parse(fs.readFileSync(filename, 'utf8'))
      records = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch { records = {} }
    return records
  }
  function fingerprint(file) {
    if (!file || !path.isAbsolute(file)) return null
    try {
      const stats = fs.statSync(file)
      return stats.isFile() && stats.size > 0
        ? { size: stats.size, mtimeMs: stats.mtimeMs }
        : null
    } catch { return null }
  }
  function get(kind, file) {
    const data = load()[kind]
    const current = fingerprint(file)
    if (!current || !data || data.path !== file ||
      data.size !== current.size || data.mtimeMs !== current.mtimeMs ||
      typeof data.version !== 'string' || !data.version) return null
    return data.version
  }
  function set(kind, file, version) {
    const current = fingerprint(file)
    if (!current || !version) return
    load()[kind] = { path: file, ...current, version }
    // A stale cache is disposable. Never prevent tool selection on a disk error.
    try {
      fs.mkdirSync(path.dirname(filename), { recursive: true })
      const tmp = filename + '.' + process.pid + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(records), { mode: 0o600 })
      fs.renameSync(tmp, filename)
    } catch {}
  }
  function clear(kind) {
    delete load()[kind]
    try {
      fs.mkdirSync(path.dirname(filename), { recursive: true })
      fs.writeFileSync(filename, JSON.stringify(records), { mode: 0o600 })
    } catch {}
  }
  return { get, set, clear }
}

// Inspect PATH without starting binaries on every settings load or app start.
// All returned paths are absolute, so callers can fingerprint and reuse them.
function findExecutableOnPath(names, envPath = process.env.PATH || '', platform = process.platform) {
  for (const folder of envPath.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const file = path.resolve(folder.replace(/^"|"$/g, ''), name)
      try {
        const stats = fs.statSync(file)
        if (!stats.isFile()) continue
        if (platform !== 'win32') fs.accessSync(file, fs.constants.X_OK)
        return file
      } catch {}
    }
  }
  return null
}

module.exports = { createToolHealthCache, findExecutableOnPath }
