#!/usr/bin/env node
// Inspect the distributed AppImage: dlopen cannot load shared libraries
// left inside app.asar. Regression check for sipbuu/lokal#521.
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function locateResources(root) {
  const dirs = [[root, 0]]
  while (dirs.length) {
    const [dir, depth] = dirs.shift()
    if (path.basename(dir) === 'resources' &&
        fs.existsSync(path.join(dir, 'app.asar.unpacked'))) return dir
    if (depth >= 8) continue
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push([path.join(dir, entry.name), depth + 1])
    }
  }
  throw new Error('No resources/app.asar.unpacked found in extracted AppImage')
}


// Check the path, not merely the SONAME: ldd may resolve a system-wide
// libvips on the CI host even when the AppImage's own RPATH is broken.
function assertBundledLibvips(output, vipsDir) {
  const linkedPath = output.match(
    /^\s*libvips-cpp\.so\S*\s+=>\s+(\/\S+)/m,
  )?.[1]
  if (!linkedPath) {
    throw new Error('Sharp addon does not resolve libvips:\n' + output)
  }
  // Resolve symlinks too: a path inside the bundle must not point to a
  // system library outside the extracted AppImage.
  const bundledDir = fs.realpathSync(vipsDir)
  const linkedFile = fs.realpathSync(linkedPath)
  const relative = path.relative(bundledDir, linkedFile)
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) ||
      path.isAbsolute(relative)) {
    throw new Error('Sharp resolved host libvips ' + linkedFile +
      ' instead of bundled libvips in ' + bundledDir)
  }
  return linkedFile
}

function checkBundledSharp(resources) {
  const unpacked = path.join(resources, 'app.asar.unpacked', 'node_modules')
  const arch = process.arch
  const sharpDir = path.join(unpacked, 'sharp', 'dist')
  const addonDir = path.join(unpacked, '@img', 'sharp-linux-' + arch, 'lib')
  const vipsDir = path.join(unpacked, '@img', 'sharp-libvips-linux-' + arch, 'lib')
  for (const dir of [sharpDir, addonDir, vipsDir]) {
    if (!fs.existsSync(dir)) throw new Error('Unpacked Sharp directory missing: ' + dir)
  }
  const addon = fs.readdirSync(addonDir).find(name => name.endsWith('.node'))
  const vips = fs.readdirSync(vipsDir).find(name => /^libvips-cpp\.so\.\d/.test(name))
  if (!addon) throw new Error('Sharp native .node missing: ' + addonDir)
  if (!vips) throw new Error('Bundled libvips-cpp.so missing: ' + vipsDir)

  // Ensures the native addon's rpath can actually locate libvips, not just
  // that both files happen to exist somewhere in the AppImage.
  const linked = spawnSync('ldd', [path.join(addonDir, addon)], { encoding: 'utf8' })
  const output = (linked.stdout || '') + (linked.stderr || '')
  if (linked.error || linked.status !== 0) {
    throw new Error('Unable to inspect Sharp addon:\n' + output +
      (linked.error ? '\n' + linked.error.message : ''))
  }
  const linkedVips = assertBundledLibvips(output, vipsDir)
  console.log('OK: Sharp ' + addon + ' resolves bundled ' + linkedVips)
}

function main() {
  if (process.platform !== 'linux') throw new Error('Requires Linux')
  const output = path.resolve(process.argv[2] || 'release')
  const images = fs.readdirSync(output)
    .filter(name => name.endsWith('.AppImage'))
    .map(name => path.join(output, name))
  if (images.length !== 1) {
    throw new Error('Expected exactly one AppImage in ' + output + ', found ' + images.length)
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-appimage-sharp-'))
  try {
    const result = spawnSync(images[0], ['--appimage-extract'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    })
    if (result.error || result.status !== 0) {
      throw new Error('AppImage extraction failed: ' +
        (result.error?.message || result.stderr || result.status))
    }
    checkBundledSharp(locateResources(path.join(dir, 'squashfs-root')))
    console.log('OK: ' + path.basename(images[0]) + ' includes Sharp and libvips')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error('AppImage Sharp packaging check failed:', error.message)
    process.exitCode = 1
  }
}

module.exports = { assertBundledLibvips }
