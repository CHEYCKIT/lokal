import assert from 'node:assert/strict'
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

test('browser protocol access is loopback-only and routes request results/events without leaking command responses as events', async () => {
  const sent = []
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))) }
    send(text) {
      const message = JSON.parse(text)
      sent.push(message)
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: message.id, result: { ok: true } }) })))
    }
    close() { this.dispatchEvent(new Event('close')) }
  }
  await assert.rejects(cdp.connectBrowser('ws://example.com/devtools/browser/1', { WebSocketImpl: Socket }), /Unexpected browser connection endpoint/)
  const connection = await cdp.connectBrowser('ws://127.0.0.1:4567/devtools/browser/1', { WebSocketImpl: Socket })
  assert.deepEqual(await connection.send('Network.getCookies', { urls: ['https://music.youtube.com'] }, 'page'), { ok: true })
  assert.equal(sent[0].sessionId, 'page')
  connection.close()
  await assert.rejects(connection.send('Browser.getVersion'), /closed/)
})
