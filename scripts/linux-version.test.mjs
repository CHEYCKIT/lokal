import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { getInstalledDebVersion, setUpdaterVersion } = require('../electron/linuxVersion')

test('uses the dpkg version of the package owning the running executable', () => {
  const calls = []
  const run = (command, args) => {
    calls.push([command, args])
    return args[0] === '--search'
      ? 'lokal-music: /opt/Lokal/lokal\n'
      : '16.1.4\n'
  }

  assert.equal(getInstalledDebVersion({
    platform: 'linux',
    executablePath: '/opt/Lokal/lokal',
    run,
  }), '16.1.4')
  assert.deepEqual(calls, [
    ['dpkg-query', ['--search', '/opt/Lokal/lokal']],
    ['dpkg-query', ['--show', '--showformat=${Version}', 'lokal-music']],
  ])
})

test('does not use a host DEB version for non-DEB Linux installs', () => {
  assert.equal(getInstalledDebVersion({
    platform: 'linux',
    run: () => { throw Object.assign(new Error('not owned by dpkg'), { status: 1 }) },
  }), null)
  assert.equal(getInstalledDebVersion({
    platform: 'win32',
    run: () => { throw new Error('must not run') },
  }), null)
})

test('sets electron-updater comparison version to the installed DEB version', () => {
  class Version {
    constructor(version) {
      this.version = version
    }
  }
  const updater = { currentVersion: new Version('16.1.2') }

  setUpdaterVersion(updater, '16.1.4')

  assert.ok(updater.currentVersion instanceof Version)
  assert.equal(updater.currentVersion.version, '16.1.4')
})
