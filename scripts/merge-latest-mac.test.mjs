import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mergeLatestMac, mergeInFolder } from './merge-latest-mac.mjs'

const ARM = `version: 3.4.0
files:
  - url: Lokal-3.4.0-arm64-mac.zip
    sha512: aaa
    size: 1
  - url: Lokal-3.4.0-arm64.dmg
    sha512: bbb
    size: 2
path: Lokal-3.4.0-arm64-mac.zip
sha512: aaa
releaseDate: '2026-10-15T00:00:00.000Z'
`
const X64 = ARM.replaceAll('-arm64', '').replace('aaa', 'ccc').replace('bbb', 'ddd').replace('sha512: aaa', 'sha512: ccc')

test('one file lists both architectures, arm64 first', () => {
  const merged = mergeLatestMac(ARM, X64)
  assert.deepEqual([...merged.matchAll(/- url: (.+)/g)].map(m => m[1]), ['Lokal-3.4.0-arm64-mac.zip', 'Lokal-3.4.0-arm64.dmg', 'Lokal-3.4.0-mac.zip', 'Lokal-3.4.0.dmg'])
  assert.match(merged, /^path: Lokal-3\.4\.0-arm64-mac\.zip$/m)
  assert.match(merged, /^releaseDate: /m)
})

test('different versions are refused', () => {
  assert.throws(() => mergeLatestMac(ARM, X64.replace('3.4.0', '3.3.0')))
})

test('the folder ends up with only latest-mac.yml', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latest-mac-'))
  fs.writeFileSync(path.join(dir, 'latest-mac.yml'), ARM)
  fs.writeFileSync(path.join(dir, 'latest-mac-x64.yml'), X64)
  assert.equal(mergeInFolder(dir), 'merged')
  assert.deepEqual(fs.readdirSync(dir), ['latest-mac.yml'])
  assert.equal(mergeInFolder(dir), 'no Intel updater file')
})
