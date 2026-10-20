// Shrink old full-size cached song covers when the original is embedded in its
// audio file. Artist, playlist, manually chosen and online-only art is kept.
const fs = require('fs')
const path = require('path')
const { filePicture } = require('./fullCover')
const { writeCover } = require('./thumb')

const HAND_PICKED = /^(artist|playlist|album)-/i
const isLocalFile = filePath => !!filePath && !/^(ghost|https?|radio):/i.test(String(filePath)) && path.isAbsolute(String(filePath)) && fs.existsSync(filePath)
const pathKey = value => process.platform === 'win32' ? path.resolve(String(value)).toLowerCase() : path.resolve(String(value))
function samePath(left, right) { return pathKey(left) === pathKey(right) }

/** Candidate full-size art is only reported when all tracks using it have a local source file. */
function shrinkableCovers(db, artworkDir) {
  const dir = path.resolve(artworkDir)
  const byCover = new Map()
  let rows = []
  try { rows = db.prepare("SELECT id, file_path, artwork_path FROM tracks WHERE artwork_path IS NOT NULL AND artwork_path != ''").all() } catch { return [] }
  for (const row of rows) {
    const art = String(row.artwork_path || '')
    const resolved = path.resolve(art)
    if (!samePath(path.dirname(resolved), dir) || path.extname(resolved).toLowerCase() === '.webp' ||
        HAND_PICKED.test(path.basename(resolved)) || !/\.(jpe?g|png)$/i.test(resolved)) continue
    const key = pathKey(resolved)
    if (!byCover.has(key)) byCover.set(key, { path: resolved, size: 0, filePaths: [], rawPaths: new Set(), trackIds: [], usable: true })
    const entry = byCover.get(key)
    entry.rawPaths.add(art)
    if (!isLocalFile(row.file_path)) entry.usable = false
    else entry.filePaths.push(row.file_path)
    entry.trackIds.push(row.id)
  }
  const out = []
  for (const entry of byCover.values()) {
    if (!entry.usable || !entry.filePaths.length) continue
    try { entry.size = fs.statSync(entry.path).size } catch { continue }
    if (entry.size > 0) out.push({ ...entry, rawPaths: [...entry.rawPaths], filePaths: [...new Set(entry.filePaths)], trackIds: [...new Set(entry.trackIds)] })
  }
  return out
}

let running = null
async function shrinkCovers(db, artworkDir, { onProgress } = {}) {
  if (running) return running
  running = shrinkAll(db, artworkDir, onProgress).finally(() => { running = null })
  return running
}
async function yieldToMain() { await new Promise(resolve => setImmediate(resolve)) }

/** Converts eligible covers and deletes originals only after all references have moved. */
async function shrinkAll(db, artworkDir, onProgress) {
  const list = shrinkableCovers(db, artworkDir)
  const storageDir = path.resolve(artworkDir)
  const keep = new Set()
  for (const sql of ['SELECT image_path AS p FROM artists', 'SELECT cover_path AS p FROM playlists']) {
    try { for (const row of db.prepare(sql).all()) if (row.p) keep.add(pathKey(row.p)) } catch {}
  }
  const convertedIds = []
  let converted = 0
  let freed = 0
  let skipped = 0
  const update = db.prepare('UPDATE tracks SET artwork_path = ? WHERE artwork_path = ?')
  for (let i = 0; i < list.length; i++) {
    const cover = list[i]
    onProgress?.({ done: i, total: list.length })
    await yieldToMain()
    let picture = null
    for (const filePath of cover.filePaths) {
      picture = await filePicture(filePath)
      if (picture) break
    }
    if (!picture) { skipped++; continue }
    // Never replace a manually chosen/external cache cover with whatever the
    // audio file currently embeds. Their image bytes must match exactly.
    try {
      if (!fs.readFileSync(cover.path).equals(picture.bytes)) { skipped++; continue }
    } catch { skipped++; continue }
    let thumbPath
    try { thumbPath = await writeCover(storageDir, path.basename(cover.path).replace(/\.[^.]+$/, ''), picture.bytes) } catch { skipped++; continue }
    if (path.extname(thumbPath).toLowerCase() !== '.webp') { skipped++; continue }
    const oldKey = pathKey(cover.path)
    try {
      db.transaction(() => {
        for (const raw of cover.rawPaths) update.run(thumbPath, raw)
      })()
    } catch { skipped++; continue }
    convertedIds.push(...(cover.trackIds || []))
    let stillReferenced = keep.has(oldKey)
    for (const row of db.prepare("SELECT artwork_path FROM tracks WHERE artwork_path IS NOT NULL AND artwork_path != ''").all()) {
      if (pathKey(row.artwork_path) === oldKey) { stillReferenced = true; break }
    }
    if (!stillReferenced) {
      let thumbSize = 0
      try { thumbSize = fs.statSync(thumbPath).size } catch {}
      try { fs.unlinkSync(cover.path); freed += Math.max(0, cover.size - thumbSize) } catch {}
    }
    converted++
  }
  onProgress?.({ done: list.length, total: list.length })
  return { converted, freed, skipped, trackIds: [...new Set(convertedIds)] }
}

module.exports = { shrinkableCovers, shrinkCovers }
