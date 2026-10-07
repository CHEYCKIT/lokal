import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import browser from '../electron/online/youtubeBrowser.js'
import cdp from '../electron/online/browserCdp.js'

test('browser capture retains only Music account context and excludes unrelated/partitioned cookies', () => {
  assert.deepEqual(browser.accountContext({ 'X-Goog-AuthUser': '2', 'X-Goog-PageId': 'brand', Cookie: 'never-store', Authorization: 'never-store', 'X-Other': 'irrelevant' }), { 'x-goog-authuser': '2', 'x-goog-pageid': 'brand' })
  assert.equal(browser.youtubeCookie({ domain: '.youtube.com' }), true)
  assert.equal(browser.youtubeCookie({ domain: 'music.youtube.com' }), true)
  for (const domain of ['.google.com', 'youtube.com.example.com', 'evilyoutube.com']) assert.equal(browser.youtubeCookie({ domain }), false)
  assert.equal(browser.youtubeCookie({ domain: '.youtube.com', partitionKey: {} }), false)
})

test('the OS default Chromium browser, including Quetta, is preferred over hardcoded Chrome/Edge', async () => {
  const calls = []
  const tools = { computeSystemExecutablePath: () => { throw new Error('Must not bypass the supported default browser') } }
  const app = { getApplicationInfoForProtocol: async url => { calls.push(url); return { name: 'Quetta Browser', path: process.execPath } } }
  assert.equal(await browser.browserExecutable('/unused', () => {}, tools, app), process.execPath)
  assert.deepEqual(calls, ['https://music.youtube.com'])
})

function pipeProcess() {
  const writer = new PassThrough(), reader = new PassThrough(), sent = []
  const child = Object.assign(new EventEmitter(), { stdio: [null, null, null, writer, reader], pid: 1 })
  writer.on('data', bytes => { for (const text of bytes.toString().split('\0').filter(Boolean)) sent.push(JSON.parse(text)) })
  return { child, writer, reader, sent, reply: message => reader.write(`${JSON.stringify(message)}\0`) }
}

test('private CDP pipes route out-of-order replies, session events, and fragmented UTF-8 frames', async () => {
  const wire = pipeProcess(), connection = await cdp.connectBrowser(wire.child)
  const events = []
  connection.on('Network.requestWillBeSent', (...args) => events.push(args))
  const first = connection.send('Network.getCookies', { urls: ['https://music.youtube.com'] }, 'page')
  const second = connection.send('Browser.getVersion')
  assert.equal(wire.sent[0].sessionId, 'page')
  wire.reply({ id: wire.sent[1].id, result: { userAgent: 'Fixture Chrome' } })
  assert.deepEqual(await second, { userAgent: 'Fixture Chrome' })
  const frame = Buffer.from(`${JSON.stringify({ id: wire.sent[0].id, result: { value: 'café 🎵' } })}\0${JSON.stringify({ method: 'Network.requestWillBeSent', params: { request: 'fixture' }, sessionId: 'page' })}\0`)
  const split = frame.indexOf(Buffer.from('🎵')) + 1
  wire.reader.write(frame.subarray(0, split))
  wire.reader.write(frame.subarray(split))
  assert.deepEqual(await first, { value: 'café 🎵' })
  assert.deepEqual(events, [[{ request: 'fixture' }, 'page']], 'command results must not be emitted as protocol events')
  wire.reader.write('invalid-json\0')
  const failed = connection.send('Unknown.command')
  wire.reply({ id: wire.sent.at(-1).id, error: { message: 'Unsupported command' } })
  await assert.rejects(failed, /Unsupported command/)
  connection.close()
  await assert.rejects(connection.send('Browser.getVersion'), /closed/)
})

test('pipe shutdown and child failures reject pending commands once and prevent further writes', async () => {
  for (const reason of ['end', 'reader-error', 'writer-error', 'exit', 'process-error', 'close']) {
    const wire = pipeProcess(), connection = await cdp.connectBrowser(wire.child)
    let closed = 0
    connection.on('closed', () => closed++)
    const rejected = assert.rejects(connection.send('Browser.getVersion'), /closed/)
    if (reason === 'end') wire.reader.end()
    else if (reason === 'reader-error') wire.reader.emit('error', new Error('Fixture read error'))
    else if (reason === 'writer-error') wire.writer.emit('error', new Error('Fixture write error'))
    else if (reason === 'exit') wire.child.emit('exit', 1)
    else if (reason === 'process-error') wire.child.emit('error', new Error('Fixture spawn error'))
    else connection.close()
    await rejected
    assert.equal(closed, 1)
    await assert.rejects(connection.send('Browser.getVersion'), /closed/)
    assert.equal(wire.sent.length, 1)
    connection.close()
    assert.equal(closed, 1)
  }
})

test('CDP requires private pipe descriptors and retains request timeouts', async () => {
  await assert.rejects(cdp.connectBrowser('ws://127.0.0.1:4567/devtools/browser/1'), /pipe is unavailable/)
  const wire = pipeProcess(), connection = await cdp.connectBrowser(wire.child, { timeoutMs: 10 })
  await assert.rejects(connection.send('Browser.getVersion'), /timed out/)
  connection.close()
})

test('browser launch uses private CDP pipes while retaining options, context/cookie capture, focus, and cleanup', async () => {
  const root = fs.mkdtempSync(path.join(process.env.LOKAL_LOGIN_TEST_TMP || os.tmpdir(), 'lokal-browser-test-'))
  const wire = pipeProcess(), app = Object.assign(new EventEmitter(), { getPath: () => root })
  const cookie = { domain: '.youtube.com', name: 'SAPISID', value: 'fixture-cookie' }
  let options, changes = 0, closeCalls = 0, login
  wire.writer.on('data', () => {
    const command = wire.sent.at(-1)
    const results = {
      'Browser.getVersion': { userAgent: 'Fixture Chrome' },
      'Target.getTargets': { targetInfos: [{ type: 'page', targetId: 'fixture-target' }] },
      'Target.attachToTarget': { sessionId: 'page' },
      'Runtime.evaluate': { result: { value: false } },
      'Network.getCookies': { cookies: [cookie, { domain: '.google.com', name: 'unrelated', value: 'fixture' }] },
    }
    queueMicrotask(() => wire.reply({ id: command.id, result: results[command.method] || {} }))
  })
  const tools = { launch: value => {
    options = value
    return { nodeProcess: wire.child, hasClosed: () => new Promise(() => {}), close: async () => { closeCalls++; wire.child.emit('exit', 0) }, waitForLineOutput: () => { throw new Error('Pipe launch must not wait for a WebSocket endpoint') } }
  } }
  try {
    login = await browser.openYouTubeBrowser({ electron: { app }, tools, executablePath: process.execPath, extraArgs: ['--lang=en-US'], onChange: () => changes++ })
    assert.equal(options.pipe, true)
    assert.ok(options.args.includes('--remote-debugging-pipe'))
    assert.ok(!options.args.some(value => /^--remote-debugging-(?:port|address)/.test(value)))
    for (const value of ['--no-first-run', '--no-default-browser-check', '--disable-background-mode', '--disable-save-password-bubble', '--window-size=480,800', '--lang=en-US', '--app=about:blank']) assert.ok(options.args.includes(value))
    assert.ok(!options.args.includes('--enable-automation'))
    for (const flag of ['handleSIGINT', 'handleSIGTERM', 'handleSIGHUP']) assert.equal(options[flag], false)
    const profile = options.args.find(value => value.startsWith('--user-data-dir=')).slice('--user-data-dir='.length)
    assert.ok(fs.existsSync(profile))
    wire.reply({ method: 'Page.frameNavigated', sessionId: 'page', params: { frame: { url: 'https://music.youtube.com/' } } })
    wire.reply({ method: 'Network.requestWillBeSent', sessionId: 'page', params: { request: { url: 'https://music.youtube.com/youtubei/v1/browse', headers: { 'X-Goog-AuthUser': '2', Cookie: 'do-not-retain' } } } })
    const snapshot = await login.read()
    assert.equal(snapshot.url, 'https://music.youtube.com/')
    assert.deepEqual(snapshot.context, { 'x-goog-authuser': '2' })
    assert.deepEqual(snapshot.cookies, [cookie])
    assert.equal(snapshot.userAgent, 'Fixture Chrome')
    assert.ok(changes >= 2)
    await login.focus()
    assert.equal(wire.sent.at(-1).method, 'Page.bringToFront')
    await login.close()
    assert.equal(closeCalls, 1)
    assert.equal(fs.existsSync(profile), false)
    assert.equal(app.listenerCount('before-quit'), 0)
  } finally {
    await login?.close()
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})
