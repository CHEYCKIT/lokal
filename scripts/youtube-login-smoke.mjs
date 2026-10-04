// Two hidden, local-only Electron runs verify a real persistent-profile restart.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const electron = createRequire(import.meta.url)('electron')
const fixture = fileURLToPath(new URL('./youtube-login.electron.cjs', import.meta.url))
const directory = fs.mkdtempSync(path.join(process.env.LOKAL_LOGIN_TEST_TMP || os.tmpdir(), 'lokal-site-first-smoke-'))
const env = { ...process.env, LOKAL_LOGIN_TEST_DATA_DIR: directory }
delete env.ELECTRON_RUN_AS_NODE
try {
  for (const [flag, expected] of [['--prepare-profile', 'Native site-first login fixture passed'], ['--restore-profile', 'Restored site-first profile passed']]) {
    const { stdout } = await promisify(execFile)(electron, [fixture, flag, '--disable-gpu'], { env, timeout: 35000, maxBuffer: 1024 * 1024 })
    assert.ok(stdout.includes(expected), 'Electron must execute the fixture and report success')
    console.log(stdout.trim())
  }
} finally { await fs.promises.rm(directory, { recursive: true, force: true }) }
