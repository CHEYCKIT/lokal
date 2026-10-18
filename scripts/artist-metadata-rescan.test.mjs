import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  getArtistNamePreference,
  artistNamePreferenceNeedsRescan,
  rememberArtistNamePreference,
  rememberArtistNamePreferenceAfterScan,
} = require('../electron/artistMetadataPreference.js')

function createSettingsDb({ clean = undefined, scanned = undefined } = {}) {
  const values = new Map()
  if (clean !== undefined) values.set('clean_download_metadata', clean)
  if (scanned !== undefined) values.set('artist_names_scan_preference', scanned)
  return {
    values,
    prepare(sql) {
      const selectedKey = sql.match(/key = '([^']+)'/)?.[1]
      const insertedKey = sql.match(/VALUES \('([^']+)'/)?.[1]
      if (sql.trimStart().startsWith('SELECT')) {
        return { get: () => {
          const value = values.get(selectedKey)
          return value === undefined ? undefined : { value }
        } }
      }
      return { run: value => {
        values.set(insertedKey, value)
        return { changes: 1 }
      } }
    },
  }
}

test('a library without an artist-name scan checkpoint refreshes once', () => {
  const db = createSettingsDb({ clean: '1' })
  assert.equal(getArtistNamePreference(db), '1')
  assert.equal(artistNamePreferenceNeedsRescan(db), true)
  rememberArtistNamePreference(db, getArtistNamePreference(db))
  assert.equal(artistNamePreferenceNeedsRescan(db), false)
})

test('turning Simpler Artist Names off invalidates the unchanged-file fast path', () => {
  const db = createSettingsDb({ clean: '1', scanned: '1' })
  assert.equal(artistNamePreferenceNeedsRescan(db), false)
  db.values.set('clean_download_metadata', '0')
  assert.equal(artistNamePreferenceNeedsRescan(db), true)
  rememberArtistNamePreference(db, getArtistNamePreference(db))
  assert.equal(artistNamePreferenceNeedsRescan(db), false)
})

test('turning Simpler Artist Names back on also triggers a refresh', () => {
  const db = createSettingsDb({ clean: '0', scanned: '0' })
  db.values.set('clean_download_metadata', '1')
  assert.equal(artistNamePreferenceNeedsRescan(db), true)
})

test('a failed scan must not mark a different preference as applied', () => {
  const db = createSettingsDb({ clean: '0', scanned: '1' })
  assert.equal(artistNamePreferenceNeedsRescan(db), true)
  assert.equal(rememberArtistNamePreferenceAfterScan(db, '0', { errors: 1 }), false)
  assert.equal(db.values.get('artist_names_scan_preference'), '1')
  assert.equal(artistNamePreferenceNeedsRescan(db), true)
})

test('a completed scan records the preference and restores incremental scanning', () => {
  const db = createSettingsDb({ clean: '0', scanned: '1' })
  assert.equal(rememberArtistNamePreferenceAfterScan(db, '0', { errors: 0, skipped: 0 }), true)
  assert.equal(db.values.get('artist_names_scan_preference'), '0')
  assert.equal(artistNamePreferenceNeedsRescan(db), false)
})

test('a scan stores its starting preference snapshot, not a mid-scan change', () => {
  const db = createSettingsDb({ clean: '0', scanned: '1' })
  const startedWith = getArtistNamePreference(db)
  db.values.set('clean_download_metadata', '1')
  rememberArtistNamePreference(db, startedWith)
  assert.equal(db.values.get('artist_names_scan_preference'), '0')
  assert.equal(artistNamePreferenceNeedsRescan(db), true)
})

test('the scanner pins the preference per scan, counts unreadable folders, spares hand-edited artists and saves the checkpoint only for a whole-library scan', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../electron/ipc/scanner.js', import.meta.url), 'utf8')
  assert.match(source, /pickPreferredArtist\(c, scanPreference\)/)
  assert.match(source, /scanStatus\.errors \+= walkFailures\.length/)
  assert.match(source, /refreshArtistNames && !\(existing && artistLinksLocked\(db, existing\.id\)\)/)
  assert.match(source, /persistArtistNamePreference && scansEveryRoot\(db, folderPath\)/)
})
