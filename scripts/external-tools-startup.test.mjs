import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createToolHealthCache, findExecutableOnPath } = require('../electron/ipc/toolHealthCache.js')
const source = fs.readFileSync(new URL('../electron/ipc/tools.js', import.meta.url), 'utf8')
const settings = fs.readFileSync(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8')

test('verified tools remain available after restarting without running the executable again', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-tool-health-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const bin = path.join(root, 'yt-dlp')
  const data = path.join(root, 'tool-health.json')
  fs.writeFileSync(bin, 'dummy executable bytes')
  const first = createToolHealthCache(data)
  assert.equal(first.get('ytdlp', bin), null)
  first.set('ytdlp', bin, '2026.10.24')
  assert.equal(createToolHealthCache(data).get('ytdlp', bin), '2026.10.24')

  // Updating a tool must invalidate a previously healthy signature.
  fs.appendFileSync(bin, ' changed')
  assert.equal(createToolHealthCache(data).get('ytdlp', bin), null)
  const fresh = createToolHealthCache(data)
  fresh.set('ytdlp', bin, '2026.10.25')
  assert.equal(createToolHealthCache(data).get('ytdlp', bin), '2026.10.25')
  fs.unlinkSync(bin)
  assert.equal(createToolHealthCache(data).get('ytdlp', bin), null)
})

test('PATH discovery is a file-system lookup, not a slow executable launch', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-path-tools-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'with spaces')
  fs.mkdirSync(dir)
  const tool = path.join(dir, 'ffmpeg')
  fs.writeFileSync(tool, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  assert.equal(findExecutableOnPath(['ffmpeg'], dir, 'linux'), tool)
  assert.equal(findExecutableOnPath(['not-installed'], dir, 'linux'), null)
})

test('custom executable is preferred, validated before saving, and never deleted after a failed probe', () => {
  const custom = source.indexOf("const user = customBinary('custom_ytdlp_path')")
  const downloaded = source.indexOf("const installed = path.join(getUserDataBin(), `yt-dlp")
  assert.ok(custom > 0 && downloaded > custom, 'saved yt-dlp path overrides downloaded copy')
  const customFfmpeg = source.indexOf("const custom = customBinary('custom_ffmpeg_path')")
  const localFfmpeg = source.indexOf("const installed = path.join(getUserDataBin(), `ffmpeg")
  assert.ok(customFfmpeg > 0 && localFfmpeg > customFfmpeg)
  assert.match(source, /getExecutableVersion\(selected, tool === 'yt-dlp'/)
  assert.match(source, /parseYtDlpVersion\(version\)/)
  assert.match(source, /cache\(\)\.get\(kind, candidatePath\)/)
  assert.ok(!source.includes('unlinkSync(executable)'), 'never delete third-party files during verification')
  assert.ok(!source.includes('execSync(`yt-dlp --version`'), 'startup discovery must not launch yt-dlp')
})

test('Custom Path opens a real executable picker and displays backend validation errors', () => {
  assert.match(settings, /name: 'Executables', extensions: \['exe'/)
  assert.match(settings, /name: 'All Files', extensions: \['\*'\]/)
  assert.match(settings, /const result = await api\.setCustomToolPath\(tool, fp\)/)
  assert.match(settings, /if \(result\?\.error\)/)
  assert.match(settings, /setCustomToolPath\('ffmpeg', true\)/)
  assert.match(settings, /setCustomToolPath\('yt-dlp', true\)/)
})
