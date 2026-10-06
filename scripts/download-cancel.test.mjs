import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { DownloadManager } = require('../electron/download/manager.js')

// Running, not just not yet reaped: a process that has exited stays a zombie
// until its parent (here, as an orphan, PID 1) collects it, and kill(pid, 0)
// still finds a zombie. On Linux /proc says which it is.
function alive(pid) {
  try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').pop()[0] !== 'Z' } catch {}
  try { process.kill(pid, 0); return true } catch { return false }
}

async function stopsWithin(pid, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 25))) {
    if (!alive(pid)) return true
  }
  return !alive(pid)
}

test('cancelling a running download also stops what it started', { skip: process.platform === 'win32' }, async () => {
  // A stand-in for yt-dlp: a launcher whose child (like ffmpeg, or the real
  // yt-dlp behind the standalone build) keeps the output open.
  // It ignores SIGTERM (from before it reports its child, so a fast cancel
  // can't catch it first), like a launcher that has to be killed outright.
  const proc = spawn(process.execPath, ['-e', `
    process.on('SIGTERM', () => {})
    const { spawn } = require('child_process')
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] })
    console.log(child.pid)
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
  assert.equal(await stopsWithin(childPid, 2000), true, 'the launcher\'s child was stopped too')
})
