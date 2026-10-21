// Export only existing lyrics. Copying a file must not trigger online lookups.
const fs = require('node:fs/promises')
const path = require('node:path')
const { parseImported } = require('../lyrics/repository')
const { retainBetterLyrics } = require('../lyrics/service')

async function exportedLyrics(row) {
  if (!row || String(row.file_path || '').startsWith('ghost://')) return null
  let cached = null
  try {
    const lines = JSON.parse(row.content || '[]')
    const meta = JSON.parse(row.meta || '{}')
    if (Array.isArray(lines) && lines.length) cached = {
      type: row.lyrics_type, source: row.source, lines,
      sync: meta.sync, language: meta.language, translationLang: meta.translationLang,
    }
  } catch {}
  let local = null
  const stem = path.join(path.dirname(row.file_path), path.basename(row.file_path, path.extname(row.file_path)))
  for (const ext of ['.ttml', '.elrc', '.lrc', '.txt']) {
    try {
      const file = stem + ext
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue
      local = parseImported(await fs.readFile(file, 'utf8'))
      if (local) break
    } catch {}
  }
  return retainBetterLyrics(local, cached)
}
module.exports = { exportedLyrics }
