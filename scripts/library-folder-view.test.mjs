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
    album: 'Album',
    file_path: path.join(album, '01-track.flac'),
  }
  const db = {
    prepare(sql) {
      if (sql.includes("key = 'music_folder'")) return { get: () => ({ value: root }) }
      if (sql.includes('COUNT(*) as count')) {
        return {
          get: (start, end) => {
            const inRange = indexedTrack.file_path >= start && indexedTrack.file_path <= end
            return { count: inRange ? 1 : 0 }
          },
        }
      }
      if (sql.includes('SELECT * FROM tracks WHERE file_path >= ? AND file_path <= ? AND (title LIKE ?')) {
        return {
          all: (start, end, term) => {
            const inRange = indexedTrack.file_path >= start && indexedTrack.file_path <= end
            const rawTerm = String(term || '').replace(/%/g, '').toLowerCase()
            const matchesText = indexedTrack.title.toLowerCase().includes(rawTerm) || indexedTrack.artist.toLowerCase().includes(rawTerm)
            return inRange && matchesText ? [indexedTrack] : []
          },
        }
      }
      if (sql.includes('SELECT * FROM tracks WHERE file_path >= ? AND file_path <= ?')) {
        return {
          all: (start, end) => {
            const inRange = indexedTrack.file_path >= start && indexedTrack.file_path <= end
            return inRange ? [indexedTrack] : []
          },
        }
      }
      return { all: (...paths) => paths.map(filePath => filePath === indexedTrack.file_path ? indexedTrack : null).filter(Boolean) }
    },
  }

  const rootView = getLibraryFolders(db, '')
  assert.equal(rootView.available, true)
  assert.deepEqual(rootView.folders.map(folder => folder.name), ['Artist'])
  assert.equal(rootView.tracks.length, 0)
  assert.equal(rootView.totalTracks, 1, 'root folder counts tracks in folders below')
  assert.equal(rootView.folders[0].trackCount, 1, 'child folder displays recursive track count')

  const artistView = getLibraryFolders(db, 'Artist')
  assert.equal(artistView.relativePath, 'Artist')
  assert.equal(artistView.tracks.length, 0, 'direct tracks in Artist folder is 0')
  assert.equal(artistView.totalTracks, 1, 'parent subfolder counts tracks in folders below instead of saying 0')
  assert.equal(artistView.allTracks.length, 1, 'parent subfolder provides recursive tracks for Play All')
  assert.equal(artistView.folders[0].name, 'Album')
  assert.equal(artistView.folders[0].trackCount, 1)

  const albumView = getLibraryFolders(db, 'Artist/Album')
  assert.equal(albumView.relativePath, 'Artist/Album')
  assert.equal(albumView.tracks.length, 1)
  assert.equal(albumView.tracks[0].id, 'track-1')
  assert.equal(albumView.totalTracks, 1)

  const searchView = getLibraryFolders(db, '', 'Track One')
  assert.equal(searchView.deepTracks.length, 1, 'deep search finds tracks in subfolders')
  assert.equal(searchView.deepTracks[0].id, 'track-1')
  assert.equal(searchView.deepTracks[0].subfolderPath, 'Artist/Album')

  const outsideView = getLibraryFolders(db, '../../outside')
  assert.equal(outsideView.notFound, true, 'paths cannot escape the configured music folder')

  console.log('Library folder view tests passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
