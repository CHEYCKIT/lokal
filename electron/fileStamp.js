// Lokal wrote into a song's file (its comment, genres, lyrics, number) and
// the library already has what it wrote: the file's new modification time is
// noted, so the folder watcher and the next scan don't read it again (which
// would also undo details edited only in the library, like the title).

const fs = require('fs')

function noteFileWritten(db, filePath) {
  try {
    const mtime = fs.statSync(filePath).mtimeMs
    db.prepare('UPDATE tracks SET last_modified = ? WHERE file_path = ?').run(mtime, filePath)
  } catch {}
}

module.exports = { noteFileWritten }
