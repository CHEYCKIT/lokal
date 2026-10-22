const path = require('path')

// The old upload receiver used this private directory exclusively. Do not
// infer mobile provenance from a filename, tags, or an unrelated PC original
// which happened to match a phone copy.
function isMobileImportPath(filePath, storageDir) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return false
  const relative = path.relative(path.join(storageDir, 'phone-downloads'), filePath)
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}

function backfillMobileSources(db, storageDir) {
  const update = db.prepare("UPDATE tracks SET download_source='mobile' WHERE id=? AND download_source IS NULL")
  let changed = 0
  for (const row of db.prepare('SELECT id,file_path FROM tracks WHERE download_source IS NULL').iterate()) {
    if (isMobileImportPath(row.file_path, storageDir)) changed += Number(update.run(row.id).changes)
  }
  return changed
}
module.exports = { isMobileImportPath, backfillMobileSources }
