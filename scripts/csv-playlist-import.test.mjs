import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import Module, { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { initDB, getDB } = require('../electron/ipc/db.js')

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-csv-import-'))
  const previous = process.env.LOKAL_DATA_DIR
  process.env.LOKAL_DATA_DIR = dir
  initDB()
  const db = getDB()
  t.after(() => {
    db.close()
    if (previous === undefined) delete process.env.LOKAL_DATA_DIR
    else process.env.LOKAL_DATA_DIR = previous
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return db
}

// Load the real IPC module with only Electron's handler registration replaced.
const handlers = new Map()
const filename = require.resolve('../electron/ipc/playlists.js')
const localRequire = createRequire(filename)
const ipcModule = { exports: {} }
vm.runInThisContext(Module.wrap(fs.readFileSync(filename, 'utf8')), { filename })(
  ipcModule.exports, id => id === 'electron' ? { ipcMain: { handle: (name, fn) => handlers.set(name, fn) } } : localRequire(id),
  ipcModule, filename, path.dirname(filename),
)
ipcModule.exports.registerPlaylistHandlers()
const webRouter = require('../server/routes/playlists.js')
const webImport = webRouter.stack.find(layer => layer.route?.path === '/external-import').route.stack[0].handle

for (const mode of ['desktop', 'web']) {
  const importCsv = async fileContent => {
    const payload = { name: 'CSV test', fileType: 'csv', fileContent }
    if (mode === 'desktop') return handlers.get('playlist:importExternalFile')(null, payload)
    let result
    webImport({ body: payload }, { json: value => { result = value } })
    return result
  }
  test(`${mode} CSV import keeps different artists and millisecond durations distinct`, async t => {
    const db = fixture(t)
    const csv = 'Track URI,ISRC,Track Name,Album Name,Artist Name(s),Duration (ms)\nspotify:track:1,USAAA2600001,Home,First,Alpha,201123\nspotify:track:2,USAAA2600002,Home,Second,Beta,209876'
    const result = await importCsv(csv)
    assert.equal(result.ghosted, 2)
    const rows = db.prepare('SELECT title, artist, duration, isrc FROM tracks ORDER BY artist').all()
    assert.deepEqual(rows, [
      { title: 'Home', artist: 'Alpha', duration: 201.123, isrc: 'USAAA2600001' },
      { title: 'Home', artist: 'Beta', duration: 209.876, isrc: 'USAAA2600002' },
    ])
  })
  test(`${mode} escaped quotes in song titles survive CSV parsing`, async t => {
    const db = fixture(t)
    await importCsv('title,artist,duration\n"The \""Quoted\""",Artist,200')
    assert.equal(db.prepare('SELECT title FROM tracks').get().title, 'The "Quoted"')
  })
  test(`${mode} an existing library namesake is not substituted for another artist`, async t => {
    const db = fixture(t)
    db.exec("INSERT INTO tracks (id, file_hash, file_path, title, artist) VALUES ('local', 'hash', '/music/other.flac', 'Home', 'Other Artist')")
    const result = await importCsv('title,artist,duration\nHome,Requested Artist,203')
    assert.equal(result.ghosted, 1)
    const row = db.prepare('SELECT t.* FROM playlist_tracks p JOIN tracks t ON t.id = p.track_id').get()
    assert.equal(row.artist, 'Requested Artist')
    assert.equal(row.duration, 203)
  })
  test(`${mode} supplied CSV imports every row without cross-song substitutions`, { skip: !process.env.LOKAL_STRESS_CSV }, async t => {
    const db = fixture(t)
    const csv = fs.readFileSync(process.env.LOKAL_STRESS_CSV, 'utf8')
    const result = await importCsv(csv)
    assert.equal(result.error, undefined)
    assert.equal(result.total, Number(process.env.LOKAL_STRESS_CSV_ROWS || 1901))
    assert.equal(result.ghosted, result.total)
    const rows = db.prepare('SELECT t.* FROM playlist_tracks p JOIN tracks t ON t.id = p.track_id').all()
    assert.equal(rows.length, result.total)
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length)
    assert.ok(rows.every(row => row.isrc && row.duration > 0 && row.duration < 36000))
    // Python's CSV reader provides an independent oracle for the supplied export.
    const expected = JSON.parse(execFileSync('python3', ['-c', `
import csv,json,sys,re
with open(sys.argv[1], encoding='utf-8-sig') as f:
 rows=list(csv.DictReader(f))
print(json.dumps([{'title':r['Track Name'], 'artist':', '.join(dict.fromkeys(x.strip() for x in re.split('[;,]',r['Artist Name(s)']) if x.strip())), 'duration':float(r['Duration (ms)'])/1000, 'isrc':r['ISRC'].replace('-', '').strip().upper()} for r in rows]))
`, process.env.LOKAL_STRESS_CSV], { encoding: 'utf8' }))
    rows.forEach(({ title, artist, duration, isrc }, i) => assert.deepEqual({ title, artist, duration, isrc }, expected[i], `CSV row ${i + 1}`))

    assert.deepEqual(db.pragma('foreign_key_check'), [])
    t.diagnostic(`${mode}: imported ${rows.length} rows with unique ghost IDs and durations in seconds.`)
  })
}
