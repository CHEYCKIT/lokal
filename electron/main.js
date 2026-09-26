const { app, BrowserWindow, ipcMain, shell, globalShortcut, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const log = require('electron-log')

const date = new Date().toISOString().replace(/[:.]/g, '-')
log.transports.file.fileName = `lokal-${date}.log`
log.transports.file.level = 'info'
log.errorHandler.startCatching()
Object.assign(console, log.functions)

const { autoUpdater } = require('electron-updater')
const { initDB, getDB } = require('./ipc/db')
const { registerScannerHandlers, registerExtraHandlers, registerV4Handlers, AUDIO_EXTS } = require('./ipc/scanner')
const { registerMixesHandlers } = require('./ipc/mixes')
const { registerPlayerHandlers } = require('./ipc/player')
const { registerDownloaderHandlers, registerExtraDownloaderHandlers, registerPlaylistArchiveHandlers, markInterruptedPlaylistsIncomplete, shutdownActiveDownloads } = require('./ipc/downloader')
const { registerLyricsHandlers } = require('./ipc/lyrics')
const { registerUserHandlers } = require('./ipc/users')
const { registerDiscordHandlers } = require('./ipc/discord')
const { registerLastFmHandlers } = require('./ipc/lastfm')
const { registerToolsHandlers } = require('./ipc/tools')
const { registerPlaylistHandlers } = require('./ipc/playlists')
const { initPlugins, registerPluginHandlers } = require('./ipc/plugins')
const { registerRecapHandlers } = require('./ipc/recaps')
const { setRemoteState, setRemoteCommandHandler } = require('./ipc/remote')
const { updateThumbarButtons, registerThumbarHandlers } = require('./ipc/thumbar')
const { registerSmtcHandlers, updateSmtcState, stopSmtcBridge } = require('./ipc/smtc')
let isUpdating = false;
const APP_PROTOCOL = 'lokal'
let pendingLastfmAuthToken = ''
let pendingOpenFilePath = ''

function findAudioFileArg(argv = []) {
  for (const arg of argv) {
    if (typeof arg !== 'string' || arg.startsWith('--') || arg.startsWith(`${APP_PROTOCOL}://`)) continue
    const ext = path.extname(arg).toLowerCase()
    if (AUDIO_EXTS.has(ext) && fs.existsSync(arg)) return path.resolve(arg)
  }
  return ''
}

function extractLastfmAuthToken(raw) {
  try {
    console.log('[DEEPLINK RAW]', raw)
    const parsed = new URL(raw)
    if (parsed.protocol !== `${APP_PROTOCOL}:`) return ''
    const target = `${parsed.host}${parsed.pathname}`
    .replace(/^\/+/, '')
    .replace(/\/+$/, '') 

  if (target !== 'lastfm-auth') return ''
    return parsed.searchParams.get('token') || ''
  } catch {
    return ''
  }
}

function emitLastfmAuthToken(token) {
  if (!token) return false

  pendingLastfmAuthToken = token

  if (!mainWindow || mainWindow.isDestroyed()) return false

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()

  const sendToken = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('lastfm:auth-token', pendingLastfmAuthToken)
    pendingLastfmAuthToken = ''
  }

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', sendToken)
  } else {
    sendToken()
  }
  console.log('[DEEPLINK TOKEN]', token)
  return true
}

function emitOpenFilePath(filePath) {
  if (!filePath) return false

  pendingOpenFilePath = filePath

  if (!mainWindow || mainWindow.isDestroyed()) return false

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()

  const sendPath = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('player:openFile', pendingOpenFilePath)
    pendingOpenFilePath = ''
  }

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', sendPath)
  } else {
    sendPath()
  }
  return true
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    const protocolUrl = commandLine.find(arg => typeof arg === 'string' && arg.startsWith(`${APP_PROTOCOL}://`))
    const token = extractLastfmAuthToken(protocolUrl || '')
    if (token) {
      emitLastfmAuthToken(token)
    }
    const filePath = findAudioFileArg(commandLine)
    if (filePath) {
      emitOpenFilePath(filePath)
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.on('update-available', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('updater:available', info)
  }
})

autoUpdater.on('download-progress', (progress) => {
  if (mainWindow) {
    mainWindow.webContents.send('updater:progress', progress)
  }
})

autoUpdater.on('update-downloaded', () => {
  if (mainWindow) {
    mainWindow.webContents.send('updater:ready')
  }
})

autoUpdater.on('error', (err) => {
  if (mainWindow) {
    mainWindow.webContents.send('updater:error', err.message)
  }
})


const settingsPath = path.join(app.getPath('userData'), 'performance-settings.json')

function loadPerformanceSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    }
  } catch (e) {}
  return { hardwareAcceleration: true, performanceMode: false }
}


const perfSettings = loadPerformanceSettings()


if (!perfSettings.hardwareAcceleration) {
  app.disableHardwareAcceleration()
  
  app.commandLine.appendSwitch('disable-software-rasterizer')
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService')

let mainWindow
const NORMAL_MIN_WIDTH = 960
const NORMAL_MIN_HEIGHT = 640
// Mini-player width stays fixed, while height starts at the measured
// default-scale content height and is then adjusted by MiniPlayer whenever
// its actual content size changes (for example from text scaling/wrapping).
const MINI_DEFAULT_WIDTH = 420
const MINI_DEFAULT_HEIGHT = 246
const MINI_MIN_HEIGHT = 120
const MINI_MAX_HEIGHT = 800
// Electron 29.1.0 has a macOS bug where setMaximumSize(0, 0) -- the
// documented way to remove a maximum -- doesn't actually lift it, leaving
// the window locked at whatever size it had when mini mode was toggled off.
// An explicit size well past any real display works around it.
const NORMAL_MAX_WIDTH = 100000
const NORMAL_MAX_HEIGHT = 100000
let miniModeRestoreState = null
let miniModeEnabled = false
let mediaKeysPreferred = false
const MEDIA_SHORTCUTS = ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack']

function enforceMiniTop() {
  if (!mainWindow || !miniModeEnabled) return
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  mainWindow.moveTop()
}

// Used when entering mini mode so the resize-to-mini-size and the
// re-centering happen as a single setBounds call instead of a separate
// setSize followed by a separate center() -- two native calls means two
// relayouts (and, on some platforms, two visible steps) instead of one.
function centeredBounds(width, height, referenceBounds) {
  const display = screen.getDisplayMatching(referenceBounds || mainWindow.getBounds())
  const area = display.workArea
  const x = Math.round(area.x + (area.width - width) / 2)
  const y = Math.round(area.y + (area.height - height) / 2)
  return { x, y, width, height }
}

function emitPlayerCommand(action) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('remote:command', { action })
}

function unregisterMediaShortcuts() {
  for (const accelerator of MEDIA_SHORTCUTS) {
    try { globalShortcut.unregister(accelerator) } catch {}
  }
}

function registerMediaShortcuts() {
  unregisterMediaShortcuts()
  const handlers = {
    MediaPlayPause: () => emitPlayerCommand('togglePlay'),
    MediaNextTrack: () => emitPlayerCommand('next'),
    MediaPreviousTrack: () => emitPlayerCommand('prev'),
  }
  let allRegistered = true
  for (const accelerator of MEDIA_SHORTCUTS) {
    try {
      const ok = globalShortcut.register(accelerator, handlers[accelerator])
      if (!ok) allRegistered = false
    } catch {
      allRegistered = false
    }
  }
  return allRegistered
}

function setPreferredMediaKeys(enabled) {
  const next = Boolean(enabled)
  if (next) {
    const ok = registerMediaShortcuts()
    mediaKeysPreferred = ok
    return { ok, enabled: mediaKeysPreferred }
  }
  unregisterMediaShortcuts()
  mediaKeysPreferred = false
  return { ok: true, enabled: false }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, process.platform === 'win32' ? '../public/lokal-icon.ico' : '../public/lokal-icon.png'),
    width: 1400, height: 860, minWidth: NORMAL_MIN_WIDTH, minHeight: NORMAL_MIN_HEIGHT,
    useContentSize: true,
    resizable: true,
    frame: false, backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, webSecurity: false,
    },
  })
  
  
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const logLevel = ['debug', 'info', 'warn', 'error'][level] || 'info'
    log[logLevel](`[Renderer:${sourceId}:${line}] ${message}`)
  })
  
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('perf-settings', perfSettings)
    if (pendingLastfmAuthToken) {
      mainWindow.webContents.send('lastfm:auth-token', pendingLastfmAuthToken)
      pendingLastfmAuthToken = ''
    }
    if (pendingOpenFilePath) {
      mainWindow.webContents.send('player:openFile', pendingOpenFilePath)
      pendingOpenFilePath = ''
    }
  })

  mainWindow.on('focus', enforceMiniTop)
  mainWindow.on('blur', enforceMiniTop)
  mainWindow.on('show', enforceMiniTop)
  mainWindow.on('restore', enforceMiniTop)

  mainWindow.on('app-command', (_, command) => {
    if (command === 'browser-backward') {
      mainWindow.webContents.send('navigation:history', -1)
    } else if (command === 'browser-forward') {
      mainWindow.webContents.send('navigation:history', 1)
    }
  })

  updateThumbarButtons(mainWindow, {})
  
  
  if (!app.isPackaged) {
    
    mainWindow.loadURL('http://localhost:5173')
  } else {
    
    const filePath = path.join(__dirname, '../dist/index.html')
    mainWindow.loadFile(filePath)
  }
}
app.name = 'Lokal'
app.whenReady().then(() => {
  if (!gotTheLock) return;
  try { require('../server/index.js') } catch (e) { console.error('Server already running or port blocked:', e.message) }
  app.name = 'Lokal'
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL)
  } else {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  }
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.lokal.music');
  }
  try { initDB() } catch (e) { console.error('DB:', e.message) }
  try { markInterruptedPlaylistsIncomplete() } catch (e) { console.error('Downloads:', e.message) }
  try { initPlugins() } catch (e) { console.error('Plugins:', e.message) }
  try {
    const db = getDB()
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'prefer_media_keys'").get()
    const preferred = setting?.value === '1'
    setPreferredMediaKeys(preferred)
  } catch (e) {
    console.warn('media key preference load failed:', e.message)
  }

  for (const fn of [
    registerScannerHandlers, registerPlayerHandlers, registerDownloaderHandlers,
    registerExtraDownloaderHandlers, registerPlaylistArchiveHandlers, registerLyricsHandlers, registerUserHandlers,
    registerDiscordHandlers, registerExtraHandlers, registerV4Handlers, registerLastFmHandlers,
    registerToolsHandlers, registerPlaylistHandlers, registerMixesHandlers, registerPluginHandlers, registerRecapHandlers
  ]) {
    try { fn(ipcMain) } catch (e) { console.error(fn.name + ':', e.message) }
  }
  try { registerThumbarHandlers(ipcMain, () => mainWindow) } catch (e) { console.error('registerThumbarHandlers:', e.message) }
  try { registerSmtcHandlers(ipcMain, () => mainWindow) } catch (e) { console.error('registerSmtcHandlers:', e.message) }


  ipcMain.on('relaunch-app', () => {
    app.relaunch()
    app.exit()
  })

  
  ipcMain.handle('perf:save', async (_, newSettings) => {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2))
      return { success: true }
    } catch (e) {
      return { error: e.message }
    }
  })

  ipcMain.handle('updater:download', async () => {
  return await autoUpdater.downloadUpdate()
})

  ipcMain.handle('perf:load', async () => {
    return perfSettings
  })
  ipcMain.handle('mediaKeys:setPreferred', async (_, flag) => {
    const result = setPreferredMediaKeys(flag)
    try {
      getDB().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('prefer_media_keys', ?)").run(result.enabled ? '1' : '0')
    } catch {}
    return result
  })
  ipcMain.on('app-log', (event, { level, message }) => {
    if (log[level]) {
      log[level](`[Renderer] ${message}`);
    } else {
      log.info(`[Renderer] ${message}`);
    }
  });
  ipcMain.on('remote:stateUpdate', (_, state) => {
    setRemoteState(state)
    updateSmtcState(state || {})
  })
  setRemoteCommandHandler(async (command) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { error: 'Main window unavailable' }
    }
    mainWindow.webContents.send('remote:command', command || {})
    return { ok: true }
  })
  ipcMain.handle('dialog:openFolder', async () => {
    const r = await require('electron').dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return r.filePaths[0] || null
  })
  ipcMain.handle('dialog:openFile', async (_, options) => {
    const normalized = Array.isArray(options) ? { filters: options } : (options || {})
    const properties = normalized.multiple ? ['openFile', 'multiSelections'] : ['openFile']
    const r = await require('electron').dialog.showOpenDialog(mainWindow, {
      properties,
      filters: normalized.filters || [{ name: 'Files', extensions: ['jpg','jpeg','png','webp','lrc','txt','ttl','ttml'] }]
    })
    return normalized.multiple ? r.filePaths : (r.filePaths[0] || null)
  })
  ipcMain.handle('dialog:readFileBinary', async (_, fp) => require('fs').readFileSync(fp, 'utf8'))
  ipcMain.handle('dialog:readFileAsDataURL', async (_, fp) => {
  try {
    const sharp = require('sharp');
    const buffer = await sharp(fp)
      .resize(512, 512, {
        fit: 'cover',  
        position: 'centre' 
      })
      .jpeg({ quality: 80 }) 
      .toBuffer();

    const base64 = buffer.toString('base64');
    return `data:image/jpeg;base64,${base64}`;
  } catch (e) {
    console.error('Error processing artwork:', e);
    try {
      const fs = require('fs');
      return `data:image/jpeg;base64,${fs.readFileSync(fp).toString('base64')}`;
    } catch (err) {
      return null;
    }
  }
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize())
ipcMain.handle('window:close', () => mainWindow?.close())
ipcMain.handle('window:setAlwaysOnTop', (_, flag) => { 
  if (mainWindow) {
    if (flag) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1)
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      mainWindow.moveTop()
    } else {
      mainWindow.setAlwaysOnTop(false)
      mainWindow.setVisibleOnAllWorkspaces(false)
    }
  }
})
ipcMain.handle('window:setSize', (_, width, height) => {
  if (mainWindow) {
    mainWindow.setSize(width, height)
    mainWindow.center()
  }
})
ipcMain.handle('window:setMiniMode', (_, enabled) => {
  if (!mainWindow) return false
  const isEnabled = Boolean(enabled)
  if (isEnabled) {
    miniModeEnabled = true
    if (!miniModeRestoreState) {
      miniModeRestoreState = {
        bounds: mainWindow.getBounds(),
        wasMaximized: mainWindow.isMaximized(),
      }
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    mainWindow.show()
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1)
    // Keep the width fixed and seed the height with the measured default
    // content height. MiniPlayer reports its actual content height after
    // mounting and whenever its layout changes; window:fitMiniHeight then
    // adjusts only the height while keeping the current position.
    mainWindow.setResizable(false)
    mainWindow.setMinimumSize(MINI_DEFAULT_WIDTH, MINI_DEFAULT_HEIGHT)
    mainWindow.setMaximumSize(MINI_DEFAULT_WIDTH, MINI_DEFAULT_HEIGHT)
    // One setBounds call instead of setSize + center(): each is a separate
    // native resize/move, i.e. a separate relayout, and doing them back to
    // back was part of what made this transition look janky.
    mainWindow.setBounds(centeredBounds(MINI_DEFAULT_WIDTH, MINI_DEFAULT_HEIGHT, miniModeRestoreState.bounds), true)
    enforceMiniTop()
    return true
  }
  miniModeEnabled = false
  mainWindow.setAlwaysOnTop(false)
  mainWindow.setVisibleOnAllWorkspaces(false)
  mainWindow.setResizable(true)
  mainWindow.setMinimumSize(NORMAL_MIN_WIDTH, NORMAL_MIN_HEIGHT)
  mainWindow.setMaximumSize(NORMAL_MAX_WIDTH, NORMAL_MAX_HEIGHT) // undoes the mini-mode lock above
  if (miniModeRestoreState?.bounds) {
    mainWindow.setBounds(miniModeRestoreState.bounds, true)
    if (miniModeRestoreState.wasMaximized) mainWindow.maximize()
  }
  miniModeRestoreState = null
  return true
})
ipcMain.handle('window:fitMiniHeight', (_, rawHeight) => {
  if (!mainWindow || !miniModeEnabled) return false
  const numericHeight = Number(rawHeight)
  if (!Number.isFinite(numericHeight)) return false

  const height = Math.round(Math.max(MINI_MIN_HEIGHT, Math.min(MINI_MAX_HEIGHT, numericHeight)))
  const bounds = mainWindow.getBounds()
  if (bounds.width === MINI_DEFAULT_WIDTH && bounds.height === height) return true

  mainWindow.setMinimumSize(MINI_DEFAULT_WIDTH, height)
  mainWindow.setMaximumSize(MINI_DEFAULT_WIDTH, height)
  mainWindow.setBounds({
    ...bounds,
    width: MINI_DEFAULT_WIDTH,
    height,
  }, true)
  enforceMiniTop()
  return true
})
ipcMain.handle('window:getSize', () => {
  if (mainWindow) {
    return mainWindow.getSize()
  }
  return [1400, 860]
})
// Windows + frame:false + `-webkit-app-region: drag` (our custom titlebar)
// is a known combination for the OS-level hit-test map going stale: after a
// burst of overlapping layout/paint changes near the titlebar -- exactly
// what closing the fullscreen player's Lyrics/Queue side panel does, since
// that unmounts a wide subtree at the same time the whole overlay is fading
// out -- Chromium can keep answering mouse input using a snapshot of the
// old layout, so every click lands offset from the cursor until something
// forces a recompute. A real restart fixes it by re-establishing the
// window from scratch; a genuine (if imperceptible) bounds change forces
// the same recompute without one. See e.g. electron/electron#7347 and
// #51252 for the same class of bug.
ipcMain.handle('window:refreshHitRegions', () => {
  if (!mainWindow) return
  const b = mainWindow.getBounds()
  mainWindow.setBounds({ ...b, width: b.width + 1 })
  mainWindow.setBounds(b)
})

createWindow()

const bootProtocolUrl = process.argv.find(arg => typeof arg === 'string' && arg.startsWith(`${APP_PROTOCOL}://`))
const bootToken = extractLastfmAuthToken(bootProtocolUrl || '')
if (bootToken) {
  emitLastfmAuthToken(bootToken)
}
const bootFilePath = findAudioFileArg(process.argv)
if (bootFilePath) {
  emitOpenFilePath(bootFilePath)
}

ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url))
ipcMain.on('open-logs', () => {
  const logFile = log.transports.file.getFile().path;
  const logDir = path.dirname(logFile);
  if (fs.existsSync(logFile)) {
    shell.showItemInFolder(logFile);
  } else {
    shell.openPath(logDir);
  }
});

ipcMain.handle('updater:install', () => {
  isUpdating = true; 
  BrowserWindow.getAllWindows().forEach(w => w.close());
  
  setTimeout(() => {
    autoUpdater.quitAndInstall(false, true); 
  }, 500);
});
  ipcMain.handle('updater:check', () => {
    autoUpdater.checkForUpdates()
  })
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  app.on('open-url', (event, url) => {
    event.preventDefault()
    const token = extractLastfmAuthToken(url)
    if (token) {
      emitLastfmAuthToken(token)
    }
  })

  if (!app.isPackaged) {
    console.log('[updater] skipping in dev mode')
  } else {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.log('[updater] check failed:', err.message)
      })
    }, 3000)
  }
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || isUpdating) {
    app.quit();
  }
})

app.on('will-quit', () => {
  try { shutdownActiveDownloads() } catch {}
  unregisterMediaShortcuts()
  try { stopSmtcBridge() } catch {}
})

app.on('before-quit', () => {
  if (isUpdating) {
    if (mainWindow) {
      mainWindow.destroy();
    }
  }
});
