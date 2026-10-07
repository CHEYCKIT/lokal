// The player's "Fill the whole screen" button uses the HTML fullscreen API.
// Electron's display blocker keeps both screen and system awake on Windows,
// Linux and macOS, including while the fullscreen player is paused.
function attachFullscreenSleepBlocker(window, { app, powerSaveBlocker }) {
  const contents = window.webContents
  let fullscreen = false
  let blockerId = null
  const listeners = []
  const listen = (target, event, handler) => {
    target.on(event, handler)
    listeners.push([target, event, handler])
  }
  const stop = () => {
    if (blockerId === null) return
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
  const sync = () => {
    if (fullscreen && !window.isDestroyed() && window.isVisible() && !window.isMinimized()) {
      if (blockerId === null) blockerId = powerSaveBlocker.start('prevent-display-sleep')
    } else stop()
  }
  const leave = () => { fullscreen = false; stop() }
  const dispose = () => {
    leave()
    for (const [target, event, handler] of listeners) target.removeListener(event, handler)
    listeners.length = 0
  }

  listen(contents, 'enter-html-full-screen', () => { fullscreen = true; sync() })
  listen(contents, 'leave-html-full-screen', leave)
  // Support native fullscreen too, and release when the OS exits it (for
  // example on macOS). The player currently enters HTML fullscreen, but this
  // keeps the ownership correct if the window-level mode is used later.
  listen(window, 'enter-full-screen', () => { fullscreen = true; sync() })
  listen(window, 'leave-full-screen', leave)
  for (const event of ['minimize', 'hide', 'restore', 'show']) listen(window, event, sync)
  listen(contents, 'render-process-gone', leave)
  listen(contents, 'did-start-navigation', details => {
    if (details.isMainFrame && !details.isSameDocument) leave()
  })
  listen(contents, 'destroyed', dispose)
  listen(window, 'closed', dispose)
  listen(app, 'will-quit', dispose)
  return dispose
}

module.exports = { attachFullscreenSleepBlocker }
