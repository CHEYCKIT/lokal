import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const { build } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)

test('Windows NSIS installer offers a destination drive/folder picker', () => {
  assert.equal(build.nsis?.oneClick, false,
    'one-click NSIS skips the installation directory wizard')
  assert.equal(build.nsis?.allowToChangeInstallationDirectory, true,
    'assisted NSIS must enable its directory selection page')
  assert.notEqual(build.nsis?.perMachine, true,
    'do not force an elevated all-users install for users choosing a drive')
})

test('Windows portable and MSIX/AppX release targets are preserved', () => {
  const windows = build.win.target
  assert.deepEqual(
    windows.map(({ target }) => target),
    ['nsis', 'portable', 'appx'],
  )
  for (const { arch } of windows) assert.deepEqual(arch, ['x64'])
  assert.equal(build.portable, undefined,
    'NSIS installer wizard settings must not leak into portable builds')
  assert.equal(build.appx?.applicationId, 'Lokal')
  assert.equal(build.appx?.identityName, 'Sipbuu.LokalMusic')
})
