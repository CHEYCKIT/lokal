const fs = require('fs')

let resolveOnlineSource = async () => ({ error: 'Online native playback is not initialized.' })

function setNativePlaybackSourceResolver(resolve) {
  if (typeof resolve === 'function') resolveOnlineSource = resolve
}

function registerNativePlaybackHandlers(ipcMain, getWindow) {
  ipcMain.handle('native-playback:source', async (event, provider, id) => {
    if (event.sender !== getWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) return { error: 'Native playback source access denied.' }
    return resolveOnlineSource(provider, id)
  })
  ipcMain.handle('native-playback:file', (event, filePath) => {
    if (event.sender !== getWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) return { error: 'Native playback file access denied.' }
    if (typeof filePath !== 'string' || filePath.length > 32768 || !fs.existsSync(filePath)) return { error: 'Audio file is unavailable.' }
    return { path: filePath }
  })
}

module.exports = { registerNativePlaybackHandlers, setNativePlaybackSourceResolver }
