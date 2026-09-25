// Windows System Media Transport Controls (SMTC) shuffle/repeat bridge.
//
// Chromium already gives Lokal a working SMTC session (play/pause/next/prev,
// metadata, lock-screen controls -- see electron/main.js's
// `enable-features=HardwareMediaKeyHandling,MediaSessionService` switch, added
// for issue #12). What Chromium's own integration can't do is shuffle/repeat:
// the standard Web `navigator.mediaSession` API (which is all Chromium's SMTC
// integration is driven by) has no shuffle/repeat actions at all, so third-party
// flyouts like FluentFlyout that read `ShuffleEnabled`/`AutoRepeatMode` off the
// OS session never see those buttons light up for Lokal.
//
// This module spawns a small separate Windows executable (native/smtc-bridge,
// a .NET Framework 4.8 console app -- see that project for why it's a plain
// child process and not a compiled Node native addon) that binds directly to
// Chromium's own SMTC session (by window handle, via the OS-sanctioned
// ISystemMediaTransportControlsInterop.GetForWindow) purely to set
// ShuffleEnabled/AutoRepeatMode and listen for the OS requesting a change to
// either. It never touches play/pause/next/prev/metadata -- Chromium keeps
// doing all of that exactly as it already does today.
//
// Wire protocol with the child process is one JSON object per line:
//   -> (us to bridge)   {"shuffle":true,"repeat":"all"}
//   <- (bridge to us)   {"event":"ready","hwnd":123456}
//   <- (bridge to us)   {"event":"shuffleRequested","value":true}
//   <- (bridge to us)   {"event":"repeatRequested","mode":"all"}

const path = require('path')
const fs = require('fs')
const { app } = require('electron')
const { spawn } = require('child_process')
// Log via electron-log's own API directly rather than the global `console`
// patch main.js installs (`Object.assign(console, log.functions)`). That
// patch is only verified to work for synchronous top-of-file code that runs
// in the same tick as the patch itself (module-load-time console.log calls
// elsewhere in this app); every line this module needs to log happens from
// an asynchronous callback (a child_process event, a timer) minutes into a
// running session, which is exactly the kind of call that went missing
// during live testing -- calling `log` directly sidesteps that gap instead
// of relying on the patch surviving into async contexts.
const log = require('electron-log')

const MAX_RESTART_ATTEMPTS = 5

let child = null
let stdoutBuffer = ''
let restartTimer = null
let restartAttempts = 0
let shuttingDown = false

function getBridgeExePath() {
  if (process.platform !== 'win32') return null
  const exeName = 'SmtcBridge.exe'
  if (app.isPackaged) {
    // Shipped as a real file via electron-builder's `extraResources`
    // (package.json), NOT inside app.asar -- see native/smtc-bridge/SmtcBridge.csproj
    // for why that matters.
    return path.join(process.resourcesPath, 'smtc-bridge', exeName)
  }
  // Dev builds: `dotnet build` output for the project directly, so
  // `npm run dev` picks up a freshly built bridge without any packaging step.
  return path.join(__dirname, '..', '..', 'native', 'smtc-bridge', 'bin', 'Debug', 'net48', exeName)
}

function startSmtcBridge(getMainWindow) {
  if (process.platform !== 'win32') return
  if (child) return

  const exePath = getBridgeExePath()
  if (!exePath || !fs.existsSync(exePath)) {
    log.warn('[smtc] bridge executable not found, shuffle/repeat SMTC sync disabled:', exePath)
    return
  }

  shuttingDown = false
  stdoutBuffer = ''

  try {
    child = spawn(exePath, [String(process.pid)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch (e) {
    log.warn('[smtc] failed to spawn bridge:', e.message)
    child = null
    return
  }

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8')
    let idx
    while ((idx = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, idx).trim()
      stdoutBuffer = stdoutBuffer.slice(idx + 1)
      if (line) handleBridgeMessage(line, getMainWindow)
    }
  })

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim()
    if (text) log.warn('[smtc-bridge]', text)
  })

  child.on('error', (e) => {
    log.warn('[smtc] bridge process error:', e.message)
  })

  child.on('exit', (code, signal) => {
    child = null
    if (shuttingDown) return
    log.warn(`[smtc] bridge exited (code=${code}, signal=${signal})`)
    if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
      log.warn('[smtc] giving up on restarting bridge after repeated failures')
      return
    }
    restartAttempts += 1
    restartTimer = setTimeout(() => startSmtcBridge(getMainWindow), 2000 * restartAttempts)
  })
}

function handleBridgeMessage(line, getMainWindow) {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }

  if (msg.event === 'ready') {
    restartAttempts = 0
    log.info('[smtc] bridge bound to Chromium SMTC session (hwnd', msg.hwnd, ')')
    return
  }

  if (msg.event === 'diag') {
    // Temporary diagnostic: TryBind() has never once succeeded in live
    // testing with zero visibility into why. See native/smtc-bridge/Bridge.cs.
    log.info(
      `[smtc] bind attempt #${msg.attempt}: targetPid=${msg.targetPid} ` +
      `totalWindowsSeen=${msg.totalWindowsSeen} windowsForTargetPid=${msg.windowsForTargetPid} ` +
      `classPrefixMatches=${msg.classPrefixMatches} hiddenNoTextMatches=${msg.hiddenNoTextMatches} ` +
      `getForWindowThrew=${msg.getForWindowThrew} controlsDisabled=${msg.controlsDisabled}` +
      (msg.lastExceptionType
        ? ` lastException=${msg.lastExceptionType}(hresult=0x${(msg.lastExceptionHResult >>> 0).toString(16)}): ${msg.lastExceptionMessage}`
        : '')
    )
    return
  }

  const win = getMainWindow && getMainWindow()
  if (!win || win.isDestroyed()) return

  if (msg.event === 'shuffleRequested') {
    win.webContents.send('smtc:shuffleRequested', !!msg.value)
  } else if (msg.event === 'repeatRequested') {
    win.webContents.send('smtc:repeatRequested', msg.mode)
  }
}

function updateSmtcState(state) {
  if (!child || !child.stdin || child.stdin.destroyed) return
  const payload = {
    shuffle: !!state.shuffle,
    repeat: state.repeat === 'all' || state.repeat === 'one' ? state.repeat : 'none',
  }
  try {
    child.stdin.write(JSON.stringify(payload) + '\n')
  } catch (e) {
    log.warn('[smtc] failed to write state to bridge:', e.message)
  }
}

function stopSmtcBridge() {
  shuttingDown = true
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (child) {
    try { child.stdin.end() } catch {}
    try { child.kill() } catch {}
    child = null
  }
}

function registerSmtcHandlers(ipcMain, getMainWindow) {
  // State pushes ride the existing 'remote:stateUpdate' channel (main.js
  // already forwards it here alongside setRemoteState) -- shuffle/repeat are
  // already part of that payload, so there's no need for a second channel.
  startSmtcBridge(getMainWindow)
}

module.exports = { registerSmtcHandlers, updateSmtcState, stopSmtcBridge }
