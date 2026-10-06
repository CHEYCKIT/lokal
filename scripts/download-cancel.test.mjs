import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { DownloadManager } = require('../electron/download/manager.js')

const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }

test('cancelling a running download also stops what it started', { skip: process.platform === 'win32' }, async () => {
  // A stand-in for yt-dlp: a launcher whose child (like ffmpeg, or the real
  // yt-dlp behind the standalone build) keeps the output open.
  const proc = spawn(process.execPath, ['-e', `
    const { spawn } = require('child_process')
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] })
    console.log(child.pid)
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 1000)
  `], { detached: true })
  proc.lokalGroup = true
  const childPid = await new Promise(resolve => proc.stdout.once('data', d => resolve(Number(String(d).trim()))))
  assert.ok(alive(childPid))

  const mgr = new DownloadManager()
  const job = { id: 'd1', kind: 'playlist', status: 'downloading', proc, opts: {}, outputLines: [] }
  mgr.jobs.set(job.id, job)
  mgr.update = (j, changes) => Object.assign(j, changes)
  const closed = new Promise(resolve => proc.once('close', resolve))
  const started = Date.now()
  const result = await mgr.cancel('d1')
  await closed
  assert.equal(result.status, 'incomplete')
  assert.ok(Date.now() - started < 5000, 'stopped without waiting for the timeout')
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(alive(childPid), false)
})
