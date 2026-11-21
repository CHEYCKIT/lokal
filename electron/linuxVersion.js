const { execFileSync } = require('child_process')

function getInstalledDebVersion({
  platform = process.platform,
  executablePath = process.execPath,
  run = execFileSync,
} = {}) {
  if (platform !== 'linux') return null

  let ownership
  try {
    ownership = run('dpkg-query', ['--search', executablePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (error) {
    if (error.code === 'ENOENT' || error.status === 1) return null
    throw error
  }

  const packageName = ownership.match(/^([^:\s,]+)(?::[^\s:]+)?:/m)?.[1]
  if (!packageName) return null

  const version = run('dpkg-query', ['--show', '--showformat=${Version}', packageName], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (!version) throw new Error(`dpkg-query returned an empty version for ${packageName}`)
  return version
}

function setUpdaterVersion(updater, version) {
  // electron-updater snapshots app.version at construction and compares against
  // this SemVer instance, so keep its baseline aligned with the installed DEB.
  updater.currentVersion = new updater.currentVersion.constructor(version)
}

module.exports = { getInstalledDebVersion, setUpdaterVersion }
