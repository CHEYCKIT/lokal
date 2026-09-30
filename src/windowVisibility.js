// Whether anyone can see the window. In the browser that's document.hidden.
// The desktop app's page never reports hidden (backgroundThrottling is off,
// see electron/main.js: minimizing hid the renderer, which dropped its
// frames and flashed white on restore), so the main process says when the
// window is minimized or hidden instead.

let windowHidden = false
let listening = false

function listen() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.electron?.onWindowVisibility?.((hidden) => {
    windowHidden = !!hidden
    window.dispatchEvent(new Event('lokal:window-visibility'))
  })
}

/** Can nobody see the window right now (minimized, hidden or a background tab)? */
export function isWindowHidden() {
  listen()
  return (typeof document !== 'undefined' && document.hidden) || windowHidden
}

/** Calls `fn(hidden)` whenever that changes; returns the unsubscribe. */
export function onWindowVisibility(fn) {
  listen()
  const handler = () => fn(isWindowHidden())
  document.addEventListener('visibilitychange', handler)
  window.addEventListener('lokal:window-visibility', handler)
  return () => {
    document.removeEventListener('visibilitychange', handler)
    window.removeEventListener('lokal:window-visibility', handler)
  }
}
