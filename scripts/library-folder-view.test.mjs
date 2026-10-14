import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { findFolderArtwork, getLibraryFolders } = require('../electron/libraryFolder.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-library-folders-'))

try {
  const album = path.join(root, 'Artist', 'Album')
  fs.mkdirSync(album, { recursive: true })
  fs.writeFileSync(path.join(album, 'a.png'), 'image')
  fs.writeFileSync(path.join(album, 'cover.jpg'), 'cover')
  fs.writeFileSync(path.join(album, '01-track.flac'), 'audio')

  assert.equal(findFolderArtwork(album), path.join(album, 'cover.jpg'), 'named cover art takes priority over other images')

  fs.unlinkSync(path.join(album, 'cover.jpg'))
  assert.equal(findFolderArtwork(album), path.join(album, 'a.png'), 'an image without a conventional name still works as fallback')

  const indexedTrack = {
    id: 'track-1',
    title: 'Track One',
    artist: 'Artist',
    file_path: path.join(album, '01-track.flac'),
  }
  const db = {
    prepare(sql) {
      if (sql.includes("key = 'music_folder'")) return { get: () => ({ value: root }) }
      return { all: (...paths) => paths.map(filePath => filePath === indexedTrack.file_path ? indexedTrack : null).filter(Boolean) }
    },
  }

  const rootView = getLibraryFolders(db, '')
  assert.equal(rootView.available, true)
  assert.deepEqual(rootView.folders.map(folder => folder.name), ['Artist'])
  assert.equal(rootView.tracks.length, 0)

  const albumView = getLibraryFolders(db, 'Artist/Album')
  assert.equal(albumView.relativePath, 'Artist/Album')
  assert.equal(albumView.tracks.length, 1)
  assert.equal(albumView.tracks[0].id, 'track-1')

  const outsideView = getLibraryFolders(db, '../../outside')
  assert.equal(outsideView.notFound, true, 'paths cannot escape the configured music folder')

  console.log('Library folder view tests passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
