const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

if (process.platform !== 'win32') process.exit(0)

const root = path.resolve(__dirname, '..')
const manifest = path.join(root, 'native', 'smtc-bridge', 'Cargo.toml')
const target = path.join(root, 'native', 'smtc-bridge', 'target', 'x86_64-pc-windows-msvc', 'release', 'smtc_bridge.dll')
const outputDir = path.join(root, 'electron', 'native')
const output = path.join(outputDir, 'smtc-bridge.win32-x64-msvc.node')

const build = spawnSync('cargo', [
  'build', '--manifest-path', manifest, '--release', '--target', 'x86_64-pc-windows-msvc',
], { cwd: root, stdio: 'inherit', shell: true })

if (build.error || build.status !== 0) {
  throw new Error('Failed to build Windows SMTC bridge' + (build.error ? ': ' + build.error.message : ''))
}

if (!fs.existsSync(target)) throw new Error('Windows SMTC bridge was not produced: ' + target)
fs.mkdirSync(outputDir, { recursive: true })
fs.copyFileSync(target, output)
console.log('Prepared ' + output)
