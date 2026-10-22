const { qualityFields, saveFields } = require('../electron/quality')

// Use the same probed format fields as a normal desktop scan, not the phone's
// file extension or a transport-level bitrate guess.
function savePhoneFileMetadata(db, id, meta, { artwork, mtimeMs }) {
  const c = meta.common || {}, f = meta.format || {}
  db.prepare(`UPDATE tracks SET download_source='mobile', album_artist=COALESCE(?,album_artist), track_num=COALESCE(?,track_num),
    year=COALESCE(?,year), genre=COALESCE(?,genre), genres=COALESCE(?,genres),
    bitrate=?, last_modified=?, artwork_path=COALESCE(?,artwork_path) WHERE id=?`)
    .run(c.albumartist || null, c.track?.no || null, c.year || null,
      c.genre?.[0] || null, c.genre?.length ? JSON.stringify(c.genre) : null,
      f.bitrate > 0 ? Math.round(f.bitrate / 1000) : null, mtimeMs, artwork || null, id)
  saveFields(db, id, qualityFields(meta), { fileChanged: true })
}
module.exports = { savePhoneFileMetadata }

// Repair the basic rows created by older phone uploads when the next comparison
// recognizes their original bytes. Keep the ID, likes and playlist references.
async function repairPhoneFileMetadata(db, id, storageDir) {
  require('../electron/quality').ensureColumns(db)
  const row = db.prepare('SELECT file_path,file_hash,quality_read_at FROM tracks WHERE id=?').get(id)
  if (!row || row.quality_read_at || !/^[a-f0-9]{64}$/i.test(row.file_hash || '') ||
      !require('../electron/mobileSource').isMobileImportPath(row.file_path, storageDir)) return
  const { parseFile } = await import('music-metadata')
  const meta = await parseFile(row.file_path, { duration: true, skipCovers: false })
  const picture = meta.common.picture?.[0]
  const artwork = picture?.data?.length
    ? await require('../electron/artwork/thumb').writeCover(require('path').join(storageDir, 'artwork'), id, picture.data)
    : null
  const stat = await require('fs').promises.stat(row.file_path)
  db.transaction(() => savePhoneFileMetadata(db, id, meta, { artwork, mtimeMs: stat.mtimeMs }))()
  return true
}
module.exports.repairPhoneFileMetadata = repairPhoneFileMetadata
