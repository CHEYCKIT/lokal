import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { isWindowsDecoderError, offerWindowsCodecHelp } = require('../electron/audio/atmos.js')

test('codec repair is limited to Windows native headphone decoder failures', () => {
  const decoder = new Error('Windows Media Foundation could not play this Dolby Atmos file: 0xC00D5212')
  assert.equal(isWindowsDecoderError(decoder, 'headphones', 'win32'), true)
  assert.equal(isWindowsDecoderError(decoder, 'hdmi', 'win32'), false)
  assert.equal(isWindowsDecoderError(decoder, 'headphones', 'linux'), false)
  assert.equal(isWindowsDecoderError(new Error('HDMI receiver rejected E-AC-3'), 'headphones', 'win32'), false)
})

test('repair requires explicit consent before opening guide', async () => {
  const urls = []
  let chosen = 1
  const electron = {
    dialog: { showMessageBox: async options => {
      assert.match(options.message, /could not decode/)
      assert.match(options.detail, /0xC00D5212/)
      return { response: chosen }
    } },
    shell: { openExternal: async url => urls.push(url) },
  }
  const failure = new Error('Windows Media Foundation could not play this Dolby Atmos file: 0xC00D5212')
  assert.equal(await offerWindowsCodecHelp(failure, 'headphones', 'win32', electron), true)
  assert.deepEqual(urls, [])
  chosen = 0
  await offerWindowsCodecHelp(failure, 'headphones', 'win32', electron)
  assert.deepEqual(urls, ['https://www.majorgeeks.com/files/details/dolby_ac_3ac_4_installer.html'])
  assert.equal(await offerWindowsCodecHelp(failure, 'hdmi', 'win32', electron), false)
})
