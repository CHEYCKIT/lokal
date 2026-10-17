import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const folderFs = require('fs-extra')
const { renameLibraryFolders, resolveLibraryFolderTarget } = require('../electron/libraryFolder.js')

function fakeDb(root, initialTracks = []) {
  const tracks = initialTracks.map(track => ({ ...track }))
  return {
    tracks,
    prepare(sql) {
      if (sql.includes("SELECT value FROM settings WHERE key = 'music_folders'")) return { get: () => ({ value: JSON.stringify([root]) }) }
      if (sql.includes("SELECT value FROM settings WHERE key = 'music_folder'")) return { get: () => ({ value: root }) }
      if (sql.startsWith('SELECT id, file_path, artwork_path FROM tracks')) {
        return { all: (prefix, upperBound) => tracks.filter(track => track.file_path >= prefix && track.file_path < upperBound && !track.file_path.startsWith('ghost://')) }
      }
      if (sql === 'UPDATE tracks SET file_path = ?, artwork_path = ? WHERE id = ?') {
        return { run: (filePath, artworkPath, id) => {
          const track = tracks.find(item => item.id === id)
          if (track) { track.file_path = filePath; track.artwork_path = artworkPath }
        } }
      }
      throw new Error('Unexpected fake DB query: ' + sql)
    },
    transaction(fn) { return (...args) => fn(...args) },
  }
}

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-folder-ops-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'Artist', 'A'), { recursive: true })
  fs.mkdirSync(path.join(root, 'Artist', 'B'), { recursive: true })
  fs.writeFileSync(path.join(root, 'Artist', 'A', 'a.flac'), 'a')
  fs.writeFileSync(path.join(root, 'Artist', 'A', 'cover.jpg'), 'cover')
  fs.writeFileSync(path.join(root, 'Artist', 'B', 'b.flac'), 'b')
  const db = fakeDb(root, [
    { id: 'a', file_path: path.join(root, 'Artist', 'A', 'a.flac'), artwork_path: path.join(root, 'Artist', 'A', 'cover.jpg') },
    { id: 'b', file_path: path.join(root, 'Artist', 'B', 'b.flac'), artwork_path: null },
  ])
  return { root, db }
}

test('renames several sibling folders and updates indexed file paths', t => {
  const { root, db } = setup(t)
  const result = renameLibraryFolders(db, [
    { path: 'Artist/A', newName: 'Alpha' },
    { path: 'Artist/B', newName: 'Beta' },
  ], root)
  assert.equal(result.success, true)
  assert.equal(fs.existsSync(path.join(root, 'Artist', 'Alpha', 'a.flac')), true)
  assert.equal(fs.existsSync(path.join(root, 'Artist', 'Beta', 'b.flac')), true)
  assert.equal(db.tracks.find(track => track.id === 'a').file_path, path.join(root, 'Artist', 'Alpha', 'a.flac'))
  assert.equal(db.tracks.find(track => track.id === 'b').file_path, path.join(root, 'Artist', 'Beta', 'b.flac'))
  assert.equal(db.tracks.find(track => track.id === 'a').artwork_path, path.join(root, 'Artist', 'Alpha', 'cover.jpg'))
})

test('bulk rename can swap names between selected sibling folders', t => {
  const { root, db } = setup(t)
  renameLibraryFolders(db, [
    { path: 'Artist/A', newName: 'B' },
    { path: 'Artist/B', newName: 'A' },
  ], root)
  assert.equal(fs.existsSync(path.join(root, 'Artist', 'A', 'b.flac')), true)
  assert.equal(fs.existsSync(path.join(root, 'Artist', 'B', 'a.flac')), true)
  assert.equal(db.tracks.find(track => track.id === 'a').file_path, path.join(root, 'Artist', 'B', 'a.flac'))
  assert.equal(db.tracks.find(track => track.id === 'b').file_path, path.join(root, 'Artist', 'A', 'b.flac'))
})

test('rejects traversal and name collisions without changing folders', t => {
  const { root, db } = setup(t)
  assert.throws(() => resolveLibraryFolderTarget(db, '../outside', root), /inside the selected music folder/)
  assert.throws(() => renameLibraryFolders(db, [{ path: 'Artist/A', newName: 'B' }], root), /already exists/)
  assert.equal(fs.existsSync(path.join(root, 'Artist', 'A', 'a.flac')), true)
  assert.equal(fs.existsSync(path.join(root, 'Artist', 'B', 'b.flac')), true)
})


test('supports folder renames that only change letter case', t => {
  const { root, db } = setup(t)
  renameLibraryFolders(db, [{ path: 'Artist/A', newName: 'a' }], root)
  assert.equal(fs.existsSync(path.join(root, 'Artist', 'a', 'a.flac')), true)
  assert.equal(db.tracks.find(track => track.id === 'a').file_path, path.join(root, 'Artist', 'a', 'a.flac'))
  assert.equal(db.tracks.find(track => track.id === 'a').artwork_path, path.join(root, 'Artist', 'a', 'cover.jpg'))
})

test('rolls back every folder if a later phase of a swap fails', t => {
  const { root, db } = setup(t)
  const originalRename = folderFs.renameSync
  let injected = false
  folderFs.renameSync = function (from, to) {
    if (!injected && String(from).includes('.lokal-rename-') && path.resolve(to) === path.join(root, 'Artist', 'A')) {
      injected = true
      const error = new Error('simulated rename failure')
      error.code = 'EIO'
      throw error
    }
    return originalRename.call(folderFs, from, to)
  }
  try {
    assert.throws(() => renameLibraryFolders(db, [
      { path: 'Artist/A', newName: 'B' },
      { path: 'Artist/B', newName: 'A' },
    ], root), /simulated rename failure/)
  } finally {
    folderFs.renameSync = originalRename
  }
  assert.equal(injected, true)
  assert.equal(fs.existsSync(path.join(root, 'Artist', 'A', 'a.flac')), true)
  assert.equal(fs.existsSync(path.join(root, 'Artist', 'B', 'b.flac')), true)
  assert.equal(fs.readdirSync(path.join(root, 'Artist')).some(name => name.startsWith('.lokal-rename-')), false)
  assert.equal(db.tracks.find(track => track.id === 'a').file_path, path.join(root, 'Artist', 'A', 'a.flac'))
  assert.equal(db.tracks.find(track => track.id === 'b').file_path, path.join(root, 'Artist', 'B', 'b.flac'))
})
