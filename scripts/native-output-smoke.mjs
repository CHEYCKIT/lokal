import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const electron = createRequire(import.meta.url)('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
try {
  const { stdout } = await promisify(execFile)(electron, [fileURLToPath(new URL('./native-output.electron.cjs', import.meta.url)), '--disable-gpu'], { env, timeout: 65000, maxBuffer: 1024 * 1024 })
  console.log(stdout.trim())
} catch (error) {
  console.error(error.stdout || '', error.stderr || '', error.message, { code: error.code, signal: error.signal, killed: error.killed })
  process.exitCode = 1
}
