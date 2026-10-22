// Compare bytes only after the cheap song/ID resolver misses. File sizes narrow
// the candidates; SHA-256 distinguishes recordings without trusting tags or a
// scanner's path-based file_hash. Nothing is uploaded, deleted or overwritten.
const fs = require('fs')
const { createHash } = require('crypto')

async function resolvePhoneFiles(db, fingerprints, { check = () => {} } = {}) {
  const sizes = new Set(fingerprints.map(item => item.size))
  const bySize = new Map()
  for (const row of db.prepare("SELECT id,file_path FROM tracks WHERE file_path NOT LIKE 'ghost://%'").iterate()) {
    check()
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
    check()
    const item = fingerprints[index]
    for (const row of bySize.get(item.size) || []) {
      if (!digests.has(row.file_path)) {
        digests.set(row.file_path, (async () => {
          try {
            const hash = createHash('sha256')
            for await (const bytes of fs.createReadStream(row.file_path)) { check(); hash.update(bytes) }
            const after = await fs.promises.stat(row.file_path)
            return after.size === row.stat.size && after.mtimeMs === row.stat.mtimeMs ? hash.digest('hex') : null
          } catch { check(); return null }
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
// A size miss proves the bytes cannot match. This avoids reading every new
// phone file in full simply to find out the PC has no possible counterpart.
async function candidateOriginalSizes(db, sizes, { check = () => {} } = {}) {
  const wanted = new Set(sizes), found = new Set()
  if (!wanted.size) return []
  for (const row of db.prepare("SELECT file_path FROM tracks WHERE file_path NOT LIKE 'ghost://%'").iterate()) {
    check()
    try {
      const stat = await fs.promises.stat(row.file_path)
      if (stat.isFile() && wanted.has(stat.size)) found.add(stat.size)
    } catch { /* Unavailable originals aren't candidates. */ }
    if (found.size === wanted.size) break
  }
  check()
  return [...found]
}
module.exports = { resolvePhoneFiles, candidateOriginalSizes }
