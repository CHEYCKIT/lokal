import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { openWebView2Login, helperPath, HelperUnavailable, LOGIN } = require('../electron/online/youtubeWebView2Login.js')

function fakeElectron() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-signin-'))
  const app = new EventEmitter()
  app.getPath = () => userData
  return { app, userData }
}

// A stand-in for LokalSignIn.exe: answers the way the real one does.
function fakeHelper({ start = 'ready', snapshot } = {}) {
  const child = new EventEmitter()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  const say = message => child.stdout.write(`${JSON.stringify(message)}\n`)
  const exit = () => setImmediate(() => child.emit('exit', 0))
  child.kill = exit
  child.started = null
  const spawnImpl = (file, args) => {
    child.started = { file, args }
    setImmediate(() => start === 'no-runtime' ? (say({ type: 'error', code: 'no-runtime', message: 'The Microsoft Edge WebView2 runtime is not installed.' }), exit()) : say({ type: 'ready' }))
    let buffered = ''
    child.stdin.on('data', chunk => {
      buffered += chunk
      for (const line of buffered.split('\n').slice(0, -1)) {
        const command = JSON.parse(line)
        if (command.cmd === 'read') say({ type: 'snapshot', id: command.id, ...snapshot })
        if (command.cmd === 'close') { say({ type: 'closed' }); exit() }
      }
      buffered = buffered.slice(buffered.lastIndexOf('\n') + 1)
    })
    return child
  }
  return { child, spawnImpl, say, exit }
}

const SNAPSHOT = {
  url: 'https://music.youtube.com/',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  context: { 'x-goog-authuser': '0', 'x-goog-visitor-id': 'Cgt2aXNpdG9y' },
  cookies: [
    { name: 'SAPISID', value: 'abc', domain: '.youtube.com', path: '/', secure: true, httpOnly: false, sameSite: 'None', session: false, expires: 1893456000 },
    { name: 'broken' },
  ],
}

test('the helper is used only on Windows, where it is installed', () => {
  assert.equal(helperPath({ platform: 'linux', exists: () => true }), null)
  assert.equal(helperPath({ platform: 'win32', resourcesPath: 'C:\\Lokal\\resources', exists: file => file.includes('resources') }), path.join('C:\\Lokal\\resources', 'webview2-signin', 'LokalSignIn.exe'))
  assert.equal(helperPath({ platform: 'win32', resourcesPath: 'C:\\x', exists: () => false }), null)
})

test('opens Google sign-in in WebView2, passes page changes on, reads the YouTube Music cookies', async () => {
  const { app, userData } = fakeElectron()
  const helper = fakeHelper({ snapshot: SNAPSHOT })
  let changes = 0
  const progress = []
  const login = await openWebView2Login({ electron: { app }, executable: 'C:\\LokalSignIn.exe', spawnImpl: helper.spawnImpl, onChange: () => changes++, onProgress: p => progress.push(p.message) })
  assert.equal(login.session, null, 'not Lokal\'s own session: the cookies come with each read')
  const args = helper.child.started.args
  assert.equal(args[args.indexOf('--url') + 1], LOGIN.href)
  const profile = args[args.indexOf('--profile') + 1]
  assert.ok(profile.startsWith(path.join(userData, 'youtube-signin')))
  assert.ok(fs.existsSync(profile))
  assert.match(progress[0], /Complete Google sign-in/)
  helper.say({ type: 'changed' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(changes, 1)
  const read = await login.read()
  assert.equal(read.url, 'https://music.youtube.com/')
  assert.match(read.userAgent, /Edg\//)
  assert.deepEqual(read.context, SNAPSHOT.context)
  assert.deepEqual(read.cookies.map(c => c.name), ['SAPISID'], 'malformed cookies dropped')
  await login.close()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(fs.existsSync(profile), false, 'its profile is deleted')
  await assert.rejects(login.read(), /closed/)
  fs.rmSync(userData, { recursive: true, force: true })
})

test('closing the window yourself reports it; Lokal closing it does not', async () => {
  const { app, userData } = fakeElectron()
  const helper = fakeHelper({ snapshot: SNAPSHOT })
  let closedByUser = 0
  await openWebView2Login({ electron: { app }, executable: 'x.exe', spawnImpl: helper.spawnImpl, onClosed: () => closedByUser++ })
  helper.say({ type: 'closed' }); helper.exit()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(closedByUser, 1)
  const other = fakeHelper({ snapshot: SNAPSHOT })
  let closedOther = 0
  const login = await openWebView2Login({ electron: { app }, executable: 'x.exe', spawnImpl: other.spawnImpl, onClosed: () => closedOther++ })
  await login.close()
  assert.equal(closedOther, 0)
  fs.rmSync(userData, { recursive: true, force: true })
})

test('no WebView2 runtime, or no helper: Lokal\'s own window takes over', async () => {
  const { app, userData } = fakeElectron()
  const helper = fakeHelper({ start: 'no-runtime' })
  await assert.rejects(openWebView2Login({ electron: { app }, executable: 'x.exe', spawnImpl: helper.spawnImpl }), error => error instanceof HelperUnavailable && /WebView2 runtime/.test(error.message))
  await assert.rejects(openWebView2Login({ electron: { app }, executable: null }), HelperUnavailable)
  const failing = () => { const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.kill = () => {}; setImmediate(() => { child.emit('error', new Error('ENOENT')); child.emit('exit', -2) }); return child }
  await assert.rejects(openWebView2Login({ electron: { app }, executable: 'x.exe', spawnImpl: failing }), HelperUnavailable)
  fs.rmSync(userData, { recursive: true, force: true })
})
