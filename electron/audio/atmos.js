'use strict'

// Dedicated E-AC-3 JOC bitstream route. Chromium's Web Audio graph decodes to
// PCM and cannot preserve Atmos metadata, so never send JOC through <audio>.
// mpv/FFmpeg exposes native WASAPI/ALSA HDMI compressed passthrough instead.
const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const { hasAtmosMetadata } = require('../mornye/atmos')

let active = null

function supportedHost(platform = process.platform) {
  return platform === 'win32' || platform === 'linux'
}

function outputOptions(platform, device) {
  if (!supportedHost(platform)) throw new Error('Native Atmos bitstream output is not available on this desktop OS')
  if (device && (typeof device !== 'string' || device.length > 160 || !/^(wasapi|alsa)\//.test(device))) {
    throw new Error('Choose a WASAPI or ALSA HDMI output device')
  }
  if (device && !device.startsWith(platform === 'win32' ? 'wasapi/' : 'alsa/')) {
    throw new Error('Selected output does not match this operating system')
  }
  // Never use a PCM mixer (PulseAudio, CoreAudio or WASAPI shared) for JOC.
  // mpv must confirm a spdif-eac3 AO before reporting playback.
  return [
    `--ao=${platform === 'win32' ? 'wasapi' : 'alsa'}`,
    ...(platform === 'win32' ? ['--audio-exclusive=yes'] : []),
    ...(device ? [`--audio-device=${device}`] : []),
    '--audio-spdif=eac3',
    '--audio-fallback-to-null=no',
    '--no-video',
    '--no-config',
    '--no-resume-playback',
    '--input-file=-',
    '--msg-level=ao=info',
    '--msg-level=audio=info',
  ]
}

function isConfirmedBitstream(logLine) {
  // AO: [wasapi] 48000Hz ... spdif-eac3. Reject PCM, even when an Atmos
  // version was selected in the catalogue; receiver output is what matters.
  return /\bAO:.*\bspdif[-_]?eac3\b/i.test(logLine)
}

function nativeAtmosAvailable(platform = process.platform) {
  if (!supportedHost(platform)) return false
  try {
    const checked = spawnSync('mpv', ['--version'], {
      windowsHide: true,
      timeout: 2000,
      stdio: 'ignore',
    })
    return checked.status === 0
  } catch { return false }
}

function registerAtmosHandlers(ipcMain, { getDB, broadcast }) {
  ipcMain.handle('atmos:capabilities', () => ({
    available: nativeAtmosAvailable(),
    platform: process.platform,
  }))
  const notify = (state) => broadcast?.('atmos:status', state)
  const stop = async () => {
    const old = active
    active = null
    if (!old) return { ok: true }
    if (old.proc) {
      const proc = old.proc
      const exited = proc.exitCode !== null
      if (!exited) {
        const done = new Promise(resolve => {
          proc.once('exit', resolve)
          setTimeout(resolve, 3000).unref?.()
        })
        proc.kill()
        await done
      }
    }
    if (old.artifact) {
      try { await old.artifact.cleanup() } catch {}
      old.artifact = null
    }
    notify({ state: 'stopped' })
    return { ok: true }
  }
  ipcMain.handle('atmos:stop', stop)
  ipcMain.handle('atmos:command', async (_, command) => {
    if (!active?.proc || !['cycle pause', 'seek 10 relative', 'seek -10 relative'].includes(command)) {
      return { error: 'No Atmos stream is running' }
    }
    active.proc.stdin.write(command + '\n')
    return { ok: true }
  })
  ipcMain.handle('atmos:play', async (_, provider, id, device = '') => {
    if (!supportedHost()) return { error: 'Atmos native HDMI output is not supported on this operating system' }
    if (!nativeAtmosAvailable()) return { error: 'Native Dolby Atmos playback requires mpv on your system PATH and an Atmos-capable HDMI output.' }
    if (typeof id !== 'string' || id.length > 200 || !/^[\w:.-]+$/.test(id)) return { error: 'Invalid track ID' }
    const options = outputOptions(process.platform, device)
    const sources = require('../online/sources')
    const key = sources.addons.keyOfProvider(provider)
    const service = require('../mornye/packages').service(getDB())
    const addon = key && service.find(key)
    if (!addon || !/tidal/i.test(addon.name || '')) return { error: 'Choose a Tidal Mornye track' }
    await stop()
    const session = { proc: null, artifact: null }
    active = session
    notify({ state: 'loading', provider, id: String(id) })
    try {
      const artifact = await service.download(key, id, {
        quality: 'DOLBY_ATMOS',
        purpose: 'download',
      })
      session.artifact = artifact
      if (active !== session) throw new Error('Atmos request was cancelled')
      if (!hasAtmosMetadata(artifact.metadata) || artifact.info?.codec !== 'eac3') {
        throw new Error('Tidal supplied stereo instead of an E-AC-3 Atmos stream')
      }
      // Spawn without a shell: the file is a Mornye-verified staging file.
      if (!fs.existsSync(artifact.file) || !path.isAbsolute(artifact.file)) throw new Error('Invalid Atmos audio file')
      const proc = spawn('mpv', [...options, artifact.file], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      session.proc = proc
      const started = await new Promise((resolve, reject) => {
        let buffer = ''
        let settled = false
        const finish = (error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (error) reject(error)
          else resolve(true)
        }
        const timer = setTimeout(() => finish(new Error('mpv did not confirm an E-AC-3 passthrough output')), 12000)
        const output = data => {
          buffer = (buffer + String(data)).slice(-4096)
          if (isConfirmedBitstream(buffer)) finish()
          else if (/AO:.*\b(?:float|s16|s24|s32)\b/i.test(buffer)) {
            finish(new Error('Audio device is outputting PCM, not Dolby Atmos bitstream'))
          }
        }
        proc.stdout.on('data', output)
        proc.stderr.on('data', output)
        proc.once('error', error => finish(new Error(`mpv could not start: ${error.message}`)))
        proc.once('exit', code => finish(new Error(`Atmos output closed (mpv exit ${code})`)))
      })
      if (active !== session) throw new Error('Atmos request was cancelled')
      notify({ state: 'playing', provider, id: String(id), codec: 'E-AC-3 JOC', output: 'compressed HDMI passthrough' })
      proc.once('exit', () => {
        if (active !== session) return
        active = null
        Promise.resolve(session.artifact?.cleanup()).catch(() => {})
        notify({ state: 'stopped' })
      })
      return { ok: !!started, codec: 'E-AC-3 JOC', output: 'compressed HDMI passthrough' }
    } catch (error) {
      if (active === session) await stop()
      else { try { await session.artifact?.cleanup() } catch {} }
      return { error: error.message || String(error) }
    }
  })
  process.once('exit', () => { try { active?.proc?.kill() } catch {} })
  return stop
}

module.exports = { supportedHost, nativeAtmosAvailable, outputOptions, isConfirmedBitstream, registerAtmosHandlers }
