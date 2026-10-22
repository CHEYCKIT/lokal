// The build tools below ship their native part as an optional package per
// platform (lightningcss-win32-x64-msvc, ...). npm skips an optional
// package whose download fails and only says so in verbose logs, so the
// build later dies in vite with "Cannot find module ...node". Loading them
// here catches that right after npm install. Exits 1 if one won't load.
const path = require('node:path')
const { createRequire } = require('node:module')

const fromRoot = createRequire(path.join(__dirname, '..', 'package.json'))
const fromVite = createRequire(fromRoot.resolve('vite/package.json'))

const checks = [
  ['lightningcss', fromRoot],
  ['@tailwindcss/oxide', fromRoot],
  ['lightningcss (vite)', fromVite, 'lightningcss'],
]

// Detect missing Sharp's native optional packages on Linux before packaging.
// npm may silently skip those packages during installation (#521).
if (process.platform === 'linux') checks.push(['sharp', fromRoot])

let failed = 0
for (const [label, requireFrom, name = label] of checks) {
  try {
    requireFrom(name)
    console.log(`ok   ${label}`)
  } catch (error) {
    failed++
    console.log(`MISSING ${label}: ${String(error.message).split('\n')[0]}`)
  }
}
process.exit(failed ? 1 : 0)
