// Whether anyone can see the window. In the browser that's document.hidden.
// The desktop app's page never reports hidden (backgroundThrottling is off,
// see electron/main.js), so the main process says when the window is
// minimized or hidden instead.
//
// On a restore, the page also tells main once it has drawn again (two
// animation frames), so main can show a Windows window it kept transparent
// while minimized without flashing white.

let windowHidden = false
let listening = false

function set(hidden) {
  if (windowHidden === !!hidden) return
  windowHidden = !!hidden
  window.dispatchEvent(new Event('lokal:window-visibility'))
}

function listen() {
  if (listening || typeof window === 'undefined') return
  listening = true
  // Subscribed first, then asked: a change sent before this ran (minimized
  // while the page was starting) isn't missed, and one arriving meanwhile
  // isn't overwritten by an older answer.
  let changed = false
  window.electron?.onWindowVisibility?.((hidden) => {
    changed = true
    set(hidden)
    if (!hidden) requestAnimationFrame(() => requestAnimationFrame(() => window.electron?.windowPainted?.()))
  })
  Promise.resolve(window.electron?.isWindowHidden?.())
    .then((hidden) => { if (!changed && typeof hidden === 'boolean') set(hidden) })
    .catch(() => {})
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
