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
// This module loads a small native Node addon (native/smtc-bridge, Rust +
// napi-rs) directly into *this* process (Electron's main process) to bind to
// Chromium's own SMTC session (by window handle, via the OS-sanctioned
// ISystemMediaTransportControlsInterop.GetForWindow) purely to set
// ShuffleEnabled/AutoRepeatMode and listen for the OS requesting a change to
// either. It never touches play/pause/next/prev/metadata -- Chromium keeps
// doing all of that exactly as it already does today.
//
// Why in-process, not a separate helper .exe: an earlier version of this
// bridge spawned a standalone .NET executable as its own OS process. Adding
// diagnostics to that version proved SystemMediaTransportControlsInterop
// .GetForWindow() throws UnauthorizedAccessException (HRESULT 0x80070005,
// E_ACCESSDENIED) on literally every call -- 1000+ attempts, across a process
// restart -- for a window handle owned by a different process (see git
// history for the full trail). That's a hard Windows security boundary on
// this specific interop call, not a bug to retry past: GetForWindow only
// succeeds when the caller and the window's owner are the same process. A
// native addon loaded into Electron's own process satisfies that trivially.
// See native/smtc-bridge/src/lib.rs for the addon itself, and its Cargo.toml
// for why Rust + the official `windows` crate rather than hand-rolled COM.

const path = require('path')
const fs = require('fs')
// Log via electron-log's own API directly rather than the global `console`
// patch main.js installs (`Object.assign(console, log.functions)`). That
// patch is only verified to work for synchronous top-of-file code that runs
// in the same tick as the patch itself; every line this module needs to log
// happens from an asynchronous callback (a timer tick) which is exactly the
// kind of call that went missing during live testing of the previous
// (helper-process) version of this bridge.
const log = require('electron-log')

const POLL_INTERVAL_MS = 100
const ARM_RETRY_INTERVAL_MS = 1000

let addon = null
let armed = false
let pollTimer = null
let armTimer = null
let lastFireCount = 0
// Buffered so a request that arrives while the window is momentarily
// unavailable (recreated during a resize, or torn down at shutdown) isn't
// silently lost: addon.pollRequests() drains the native side's pending
// value the instant it's read (see poll_requests()'s Option::take() in
// native/smtc-bridge/src/lib.rs), whether or not this function ever manages
// to deliver it anywhere. Holding the most recent request here until a live
// window exists to receive it means recovery still gets the OS's last
// desired state instead of nothing. null means "nothing undelivered" --
// distinct from a real value of `false` (shuffle off) or `0` (repeat none).
let pendingShuffle = null
let pendingRepeat = null

function getAddonPath() {
  if (process.platform !== 'win32') return null
  // Built by scripts/prepare-native.js (runs via the `native:prepare` npm
  // script, wired into both `postinstall` and `build`) into electron/native/,
  // and shipped unpacked from app.asar via the `asarUnpack` entry in
  // package.json -- a native .node file can't be loaded from inside the
  // asar archive at all (the OS's dynamic library loader needs a real path
  // on disk, which a read-only virtual archive can't provide). Electron
  // transparently redirects fs/require access for unpacked paths to
  // app.asar.unpacked at runtime, so this one relative path works
  // unchanged in both dev and packaged builds.
  return path.join(__dirname, '..', 'native', 'smtc-bridge.win32-x64-msvc.node')
}

function loadAddon() {
  const addonPath = getAddonPath()
  if (!addonPath || !fs.existsSync(addonPath)) {
    log.warn('[smtc] native addon not found, shuffle/repeat SMTC sync disabled:', addonPath)
    return null
  }
  try {
    return require(addonPath)
  } catch (e) {
    log.warn('[smtc] failed to load native addon:', e.message)
    return null
  }
}

function pollRequests(getMainWindow) {
  if (!addon) return

  let requests
  try {
    requests = addon.pollRequests()
  } catch (e) {
    log.warn('[smtc] pollRequests failed:', e.message)
    return
  }

  // napi-rs's snake_case -> camelCase field conversion for #[napi(object)]
  // structs is its documented default; check both forms so a wrong
  // assumption here doesn't silently break the one diagnostic that shows
  // whether the native WinRT handler is firing at all.
  const fireCount = requests.fireCount ?? requests.fire_count ?? 0
  if (fireCount !== lastFireCount) {
    log.info('[smtc] native handler fired (fireCount', lastFireCount, '->', fireCount, ') shuffle:', requests.shuffle, 'repeat:', requests.repeat)
    lastFireCount = fireCount
  }

  // Latest request wins over anything still buffered from an earlier tick --
  // these represent "what the OS wants right now", not a queue of discrete
  // actions, so an unread older value is superseded rather than preserved
  // alongside it.
  if (requests.shuffle !== null && requests.shuffle !== undefined) {
    pendingShuffle = requests.shuffle
  }
  if (requests.repeat !== null && requests.repeat !== undefined) {
    pendingRepeat = requests.repeat
  }

  const win = getMainWindow && getMainWindow()
  if (!win || win.isDestroyed()) return

  if (pendingShuffle !== null) {
    win.webContents.send('smtc:shuffleRequested', !!pendingShuffle)
    pendingShuffle = null
  }
  if (pendingRepeat !== null) {
    const mode = pendingRepeat === 1 ? 'all' : pendingRepeat === 2 ? 'one' : 'none'
    win.webContents.send('smtc:repeatRequested', mode)
    pendingRepeat = null
  }
}

function startPolling(getMainWindow) {
  if (pollTimer) return
  pollTimer = setInterval(() => pollRequests(getMainWindow), POLL_INTERVAL_MS)
}

function tryArm() {
  if (!addon || armed) return armed

  let win
  try {
    win = addon.findChromiumSmtcWindow()
  } catch (e) {
    log.warn('[smtc] findChromiumSmtcWindow failed:', e.message)
    return false
  }
  if (!win || !win.hwnd) return false

  try {
    const hwnd = Number(win.hwnd)
    addon.armShuffleRepeat(hwnd)
    armed = true
    log.info('[smtc] bridge bound to Chromium SMTC session (hwnd', hwnd, ')')
    return true
  } catch (e) {
    log.warn('[smtc] arm attempt failed:', e.message)
    return false
  }
}

function startSmtcBridge(getMainWindow) {
  if (process.platform !== 'win32') return
  if (addon) return

  addon = loadAddon()
  if (!addon) return

  if (tryArm()) {
    startPolling(getMainWindow)
    return
  }

  // Chromium creates/activates its SMTC session only once its media session
  // is live -- retry until that hidden window can actually be found.
  armTimer = setInterval(() => {
    if (tryArm()) {
      clearInterval(armTimer)
      armTimer = null
      startPolling(getMainWindow)
    }
  }, ARM_RETRY_INTERVAL_MS)
}

function updateSmtcState(state) {
  if (!addon || !armed) return
  try {
    addon.setShuffleState(!!state.shuffle)
    const repeat = state.repeat === 'all' ? 1 : state.repeat === 'one' ? 2 : 0
    addon.setRepeatState(repeat)
  } catch (e) {
    log.warn('[smtc] failed to write state to bridge:', e.message)
  }
}

function stopSmtcBridge() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (armTimer) {
    clearInterval(armTimer)
    armTimer = null
  }
}

function registerSmtcHandlers(ipcMain, getMainWindow) {
  // State pushes ride the existing 'remote:stateUpdate' channel (main.js
  // already forwards it here alongside setRemoteState) -- shuffle/repeat are
  // already part of that payload, so there's no need for a second channel.
  startSmtcBridge(getMainWindow)
}

module.exports = { registerSmtcHandlers, updateSmtcState, stopSmtcBridge }
