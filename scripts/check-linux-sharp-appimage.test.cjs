'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { assertBundledLibvips } = require('./check-linux-sharp-appimage.cjs')

test('accepts only a libvips resolved from the AppImage bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-ldd-test-'))
  try {
    const bundled = path.join(root, 'app.asar.unpacked', 'node_modules',
      '@img', 'sharp-libvips-linux-x64', 'lib')
    const host = path.join(root, 'host-lib')
    fs.mkdirSync(bundled, { recursive: true })
    fs.mkdirSync(host)
    const name = 'libvips-cpp.so.8.18.7'
    const bundledLib = path.join(bundled, name)
    const hostLib = path.join(host, name)
    fs.writeFileSync(bundledLib, '')
    fs.writeFileSync(hostLib, '')
    const ldd = (resolved) =>
      'linux-vdso.so.1 (0x7fff)\n' +
      name + ' => ' + resolved + ' (0x7fca)\n' +
      'libc.so.6 => /usr/lib/libc.so.6 (0x7fc1)\n'

    assert.equal(assertBundledLibvips(ldd(bundledLib), bundled),
      fs.realpathSync(bundledLib))
    assert.throws(() => assertBundledLibvips(ldd(hostLib), bundled),
      /host libvips/)
    assert.throws(() => assertBundledLibvips(
      name + ' => not found\n', bundled), /does not resolve/)
    assert.throws(() => assertBundledLibvips(
      'libc.so.6 => /usr/lib/libc.so.6 (0x7fc1)\n', bundled),
      /does not resolve/)

    const linkedOutside = path.join(bundled, 'libvips-cpp.so.8.18.8')
    fs.symlinkSync(hostLib, linkedOutside)
    assert.throws(() => assertBundledLibvips(ldd(linkedOutside), bundled),
      /host libvips/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
