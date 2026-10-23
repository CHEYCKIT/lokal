'use strict'

// Windows Media Foundation/WinRT path. Unlike the mpv HDMI route, this
// delegates the *original* E-AC-3 JOC file to the Windows media pipeline.
// Actual spatial rendering depends on the installed Dolby decoder and the
// Windows Spatial Sound setting of the active headphones. Neither merely
// opening the file nor hearing stereo is evidence of Atmos object rendering.
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

let bridge
function headphoneBridge(platform = process.platform) {
  if (platform !== 'win32') return null
  if (bridge) return bridge
  const filename = path.join(__dirname, '..', 'native', 'smtc-bridge.win32-x64-msvc.node')
  if (!fs.existsSync(filename)) return null
  try {
    const loaded = require(filename)
    if (typeof loaded.startAtmosHeadphones !== 'function' ||
      typeof loaded.atmosHeadphoneStatus !== 'function' ||
      typeof loaded.stopAtmosHeadphones !== 'function' ||
      typeof loaded.atmosHeadphoneCommand !== 'function') return null
    bridge = loaded
  } catch { return null }
  return bridge
}

function headphoneCapability(platform = process.platform) {
  return { available: !!headphoneBridge(platform),
    mode: 'windows-media-foundation',
    // A native decoder successfully opening the file cannot establish that
    // the OS spatial renderer processed JOC metadata.
    rendererVerified: false }
}

async function startHeadphones(filename, { signal, timeoutMs = 15000, onStatus } = {}) {
  const native = headphoneBridge()
  if (!native) throw new Error('The Windows headphone audio bridge is missing. Install the Windows version of Lokal with native support.')
  if (!path.isAbsolute(filename) || !fs.statSync(filename).isFile()) throw new Error('Invalid local Atmos source')
  signal?.throwIfAborted()
  native.startAtmosHeadphones(pathToFileURL(filename).href)
  try {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      signal?.throwIfAborted()
      const state = native.atmosHeadphoneStatus()
      if (state.state === 'playing') {
        onStatus?.(state)
        return state
      }
      if (state.state === 'error') throw new Error('Windows Media Foundation: ' + (state.error || 'The decoder could not open the Atmos file'))
      if (state.state === 'ended' || state.state === 'stopped') throw new Error('Windows native playback stopped before it started')
      await new Promise(resolve => setTimeout(resolve, 180))
    }
    throw new Error('Windows audio did not start. Check the E-AC-3 decoder and enable Spatial Sound on the selected headphones.')
  } catch (error) {
    try { native.stopAtmosHeadphones() } catch {}
    throw error
  }
}

function headphoneStatus() {
  return headphoneBridge()?.atmosHeadphoneStatus() || { state: 'unavailable' }
}

function stopHeadphones() {
  headphoneBridge()?.stopAtmosHeadphones()
}

function headphoneCommand(command) {
  const native = headphoneBridge()
  if (!native) throw new Error('Windows headphone playback is unavailable')
  native.atmosHeadphoneCommand(command)
}

module.exports = { headphoneBridge, headphoneCapability, startHeadphones, stopHeadphones, headphoneCommand, headphoneStatus }
