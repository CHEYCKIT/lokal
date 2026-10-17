import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { findFolderArtwork, getLibraryFolders } = require('../electron/libraryFolder.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-library-folders-'))
const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-library-folders-second-'))

function likeMatches(value, pattern) {
  const regexSpecials = '.^$*+?()[]{}|\\'
  let expression = ''
  for (let i = 0; i < pattern.length; i++) {
    let character = pattern[i]
    if (character === '\\' && i + 1 < pattern.length) {
      character = pattern[++i]
      expression += regexSpecials.includes(character) ? '\\' + character : character
    } else if (character === '%') {
      expression += '.*'
    } else if (character === '_') {
      expression += '.'
    } else {
      expression += regexSpecials.includes(character) ? '\\' + character : character
    }
  }
  return new RegExp('^' + expression + '$', 'i').test(String(value == null ? '' : value))
}

try {
  const album = path.join(root, 'Artist', 'Album')
  const emojiAlbum = path.join(root, '🎧Artist', 'Album')
  const secondAlbum = path.join(secondRoot, 'Second Artist', 'Second Album')
  const secondTrackPath = path.join(secondAlbum, '01-second.flac')
  fs.mkdirSync(album, { recursive: true })
  fs.mkdirSync(emojiAlbum, { recursive: true })
  fs.mkdirSync(secondAlbum, { recursive: true })
  fs.writeFileSync(secondTrackPath, 'audio')
  fs.writeFileSync(path.join(album, 'a.png'), 'image')
  fs.writeFileSync(path.join(album, 'cover.jpg'), 'cover')
  fs.writeFileSync(path.join(album, 'Album Art.jpg'), 'named album art')
  fs.writeFileSync(path.join(album, '01-track.flac'), 'audio')
  fs.writeFileSync(path.join(album, '02-percent.flac'), 'audio')
  fs.writeFileSync(path.join(album, '03-underscore.flac'), 'audio')
  const trackCoverA = path.join(root, 'track-cover-a.jpg')
  const trackCoverB = path.join(root, 'track-cover-b.jpg')
  fs.writeFileSync(trackCoverA, 'cover a')
  fs.writeFileSync(trackCoverB, 'cover b')

  assert.equal(findFolderArtwork(album), path.join(album, 'cover.jpg'), 'named cover art takes priority over other images')
  fs.unlinkSync(path.join(album, 'cover.jpg'))
  assert.equal(findFolderArtwork(album), path.join(album, 'Album Art.jpg'), 'spaced conventional cover names are recognized')
  fs.unlinkSync(path.join(album, 'Album Art.jpg'))
  assert.equal(findFolderArtwork(album), path.join(album, 'a.png'), 'an image without a conventional name still works as fallback')
  fs.renameSync(path.join(album, 'a.png'), path.join(album, 'covers.jpg'))
  fs.writeFileSync(path.join(album, 'poster.png'), 'poster')
  assert.equal(findFolderArtwork(album), null, 'plural covers is not treated as an explicit cover when images differ')
  fs.renameSync(path.join(album, 'covers.jpg'), path.join(album, 'a.png'))
  fs.unlinkSync(path.join(album, 'poster.png'))

  const indexedTracks = [
    { id: 'track-1', title: 'Track One', artist: 'Artist', album: 'Album', file_path: path.join(album, '01-track.flac'), artwork_path: trackCoverA },
    { id: 'track-percent', title: 'Literal 100% Track', artist: 'Artist', album: 'Album', file_path: path.join(album, '02-percent.flac'), artwork_path: trackCoverB },
    { id: 'track-underscore', title: 'Name_with_underscore', artist: 'Artist', album: 'Album', file_path: path.join(album, '03-underscore.flac'), artwork_path: trackCoverA },
    // This row is stale: it must not count or appear in a playable queue.
    { id: 'stale', title: 'Deleted Track', artist: 'Artist', album: 'Album', file_path: path.join(album, 'deleted.flac') },
  ]
  indexedTracks.push({ id: 'second-root-track', title: 'Second Root Track', artist: 'Second Artist', album: 'Second Album', file_path: secondTrackPath })
  for (let i = 0; i < 1001; i++) {
    const filename = 'bulk-' + String(i).padStart(4, '0') + '.flac'
    const filePath = path.join(emojiAlbum, filename)
    fs.writeFileSync(filePath, 'audio')
    indexedTracks.push({ id: 'bulk-' + i, title: 'Bulk Track ' + i, artist: 'Bulk Artist', album: 'Large Album', file_path: filePath })
  }

  const isInRange = (filePath, start, end) => filePath >= start && filePath < end
  const db = {
    prepare(sql) {
      if (sql.includes("key = 'music_folders'")) return { get: () => ({ value: JSON.stringify([root, secondRoot]) }) }
      if (sql.includes("key = 'music_folder'")) return { get: () => ({ value: root }) }
      if (sql.includes('SELECT id, file_path, artwork_path, artwork_url FROM tracks')) {
        return {
          all: (start, end) => indexedTracks
            .filter(track => isInRange(track.file_path, start, end) && (track.artwork_path || track.artwork_url))
            .map(({ id, file_path, artwork_path, artwork_url }) => ({ id, file_path, artwork_path, artwork_url }))
            .sort((a, b) => a.file_path.localeCompare(b.file_path)),
        }
      }
      if (sql.includes('SELECT file_path FROM tracks')) {
        return {
          all: (start, end) => indexedTracks
            .filter(track => isInRange(track.file_path, start, end))
            .map(track => ({ file_path: track.file_path }))
            .sort((a, b) => a.file_path.localeCompare(b.file_path)),
        }
      }
      if (sql.includes('FROM tracks WHERE file_path IN (')) {
        return { all: (...paths) => indexedTracks.filter(track => paths.includes(track.file_path)) }
      }
      if (sql.includes('substr(file_path, length(?)+1) LIKE ?')) {
        return {
          all: (start, end, titlePattern, artistPattern, albumPattern, pathPrefix, pathPattern) =>
            indexedTracks.filter(track =>
              isInRange(track.file_path, start, end) &&
              (likeMatches(track.title, titlePattern) ||
                likeMatches(track.artist, artistPattern) ||
                likeMatches(track.album, albumPattern) ||
                likeMatches(track.file_path.slice(pathPrefix.length), pathPattern))),
        }
      }
      throw new Error('Unexpected SQL in library folder test: ' + sql)
    },
  }

  const rootView = getLibraryFolders(db, '')
  assert.equal(rootView.available, true)
  assert.deepEqual(rootView.rootPaths, [root, secondRoot], 'the folder browser reports every configured music root')
  assert.deepEqual(rootView.folders.map(folder => folder.name).sort(), ['Artist', '🎧Artist'])
  assert.equal(rootView.tracks.length, 0)
  assert.equal(rootView.totalTracks, 1004, 'root count excludes stale database paths')
  assert.equal(rootView.allTracks.length, 1004, 'Play All includes every descendant, with no 1,000-track cap')
  assert.equal(rootView.folders.find(folder => folder.name === 'Artist').trackCount, 3, 'child folder count is recursive and excludes stale files')
  const artistFolder = rootView.folders.find(folder => folder.name === 'Artist')
  assert.equal(artistFolder.artwork_tracks.length, 2, 'a folder without a direct image exposes distinct album covers for a collage')
  assert.deepEqual(new Set(artistFolder.artwork_tracks.map(track => track.artwork_path)), new Set([trackCoverA, trackCoverB]))
  assert.equal(rootView.folders.find(folder => folder.name === '🎧Artist').trackCount, 1001, 'emoji-leading folder names are included in the recursive count')

  const secondRootView = getLibraryFolders(db, '', '', secondRoot)
  assert.equal(secondRootView.available, true, 'a configured secondary music root can be browsed')
  assert.equal(secondRootView.rootPath, secondRoot)
  assert.equal(secondRootView.rootName, path.basename(secondRoot))
  const secondAlbumView = getLibraryFolders(db, 'Second Artist/Second Album', '', secondRoot)
  assert.deepEqual(secondAlbumView.tracks.map(track => track.id), ['second-root-track'])
  const invalidRootView = getLibraryFolders(db, '', '', path.join(os.tmpdir(), 'not-configured'))
  assert.equal(invalidRootView.available, false, 'root overrides cannot browse folders outside the configured root list')

  const artistView = getLibraryFolders(db, 'Artist')
  assert.equal(artistView.relativePath, 'Artist')
  assert.equal(artistView.tracks.length, 0, 'direct tracks in Artist folder is 0')
  assert.equal(artistView.totalTracks, 3, 'parent subfolder counts tracks below it')
  assert.equal(artistView.allTracks.length, 3, 'parent subfolder Play All includes all valid descendants')
  assert.equal(artistView.folders[0].name, 'Album')
  assert.equal(artistView.folders[0].trackCount, 3)
  assert.equal(artistView.folders[0].artwork_path, path.join(album, 'a.png'), 'an image inside a folder is used as its cover');
  assert.equal(artistView.folders[0].artwork_tracks.length, 2, 'track covers remain available as fallback artwork')

  const emojiView = getLibraryFolders(db, '🎧Artist')
  assert.equal(emojiView.totalTracks, 1001)
  assert.equal(emojiView.allTracks.length, 1001, 'Unicode folder Play All returns every descendant')

  const albumView = getLibraryFolders(db, 'Artist/Album')
  assert.equal(albumView.relativePath, 'Artist/Album')
  assert.equal(albumView.tracks.length, 3)
  assert.equal(albumView.totalTracks, 3)

  const searchView = getLibraryFolders(db, '', 'Track One')
  assert.equal(searchView.deepTracks.length, 1, 'deep search finds tracks in subfolders')
  assert.equal(searchView.deepTracks[0].id, 'track-1')
  assert.equal(searchView.deepTracks[0].subfolderPath, 'Artist/Album')

  assert.equal(getLibraryFolders(db, '', 'lokal-library-folders').deepTracks.length, 0,
    'deep search only searches the path relative to the selected folder')
  assert.deepEqual(getLibraryFolders(db, '', '100%').deepTracks.map(track => track.id), ['track-percent'],
    'percent signs in a query are treated literally')
  assert.deepEqual(getLibraryFolders(db, '', '_').deepTracks.map(track => track.id), ['track-underscore'],
    'underscores in a query are treated literally')

  const outsideView = getLibraryFolders(db, '../../outside')
  assert.equal(outsideView.notFound, true, 'paths cannot escape the configured music folder')

  console.log('Library folder view tests passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(secondRoot, { recursive: true, force: true })
}
