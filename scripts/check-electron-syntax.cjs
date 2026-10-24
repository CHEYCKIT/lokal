'use strict'

// The frontend Vite build does not parse Electron main-process files.
// Verify every bundled Electron JS module before creating an installer.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const electronDir = path.join(root, 'electron')
const files = []

function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name)
    if (item.isDirectory()) walk(file)
    else if (item.isFile() && /\.(?:js|cjs|mjs)$/.test(item.name)) files.push(file)
  }
}

walk(electronDir)
files.sort()
if (!files.length) {
  console.error('No Electron JavaScript sources found')
  process.exit(1)
}

let failed = false
for (const file of files) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (check.status === 0 && !check.error) continue
  failed = true
  console.error(`Invalid Electron JavaScript: ${path.relative(root, file)}`)
  if (check.error) console.error(check.error.message)
  if (check.stderr) console.error(check.stderr.trim())
  if (check.stdout) console.error(check.stdout.trim())
}

if (failed) process.exitCode = 1
else console.log(`Electron syntax OK (${files.length} files checked)`)
