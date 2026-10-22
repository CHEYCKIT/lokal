// Compare bytes only after the cheap song/ID resolver misses. File sizes narrow
// the candidates; SHA-256 distinguishes recordings without trusting tags or a
// scanner's path-based file_hash. Nothing is uploaded, deleted or overwritten.
const fs = require('fs')
const { createHash } = require('crypto')

async function resolvePhoneFiles(db, fingerprints) {
  const sizes = new Set(fingerprints.map(item => item.size))
  const bySize = new Map()
  for (const row of db.prepare("SELECT id,file_path FROM tracks WHERE file_path NOT LIKE 'ghost://%'").iterate()) {
    try {
      const stat = await fs.promises.stat(row.file_path)
      if (!stat.isFile() || !sizes.has(stat.size)) continue
      const group = bySize.get(stat.size) || []
      group.push({ ...row, stat })
      bySize.set(stat.size, group)
    } catch { /* An unavailable original isn't a copy. */ }
  }
  const digests = new Map(), matches = []
  for (let index = 0; index < fingerprints.length; index++) {
    const item = fingerprints[index]
    for (const row of bySize.get(item.size) || []) {
      if (!digests.has(row.file_path)) {
        digests.set(row.file_path, (async () => {
          try {
            const hash = createHash('sha256')
            for await (const bytes of fs.createReadStream(row.file_path)) hash.update(bytes)
            const after = await fs.promises.stat(row.file_path)
            return after.size === row.stat.size && after.mtimeMs === row.stat.mtimeMs ? hash.digest('hex') : null
          } catch { return null }
        })())
      }
      if (await digests.get(row.file_path) === item.sha256.toLowerCase()) {
        matches.push({ index, trackId: String(row.id) })
        break
      }
    }
  }
  return matches
}
module.exports = { resolvePhoneFiles }
