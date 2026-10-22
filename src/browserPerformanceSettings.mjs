const key = 'lokal:performance-settings'
const changed = 'lokal:performance-settings-changed'
const defaults = { hardwareAcceleration: true, performanceMode: false }

export function loadBrowserPerformanceSettings(host = globalThis.window) {
  try {
    const saved = JSON.parse(host.localStorage.getItem(key) || '{}')
    return {
      hardwareAcceleration: saved.hardwareAcceleration !== false,
      performanceMode: saved.performanceMode === true,
    }
  } catch { return { ...defaults } }
}

export function saveBrowserPerformanceSettings(patch, host = globalThis.window) {
  try {
    const next = loadBrowserPerformanceSettings(host)
    for (const field of Object.keys(defaults)) {
      if (typeof patch?.[field] === 'boolean') next[field] = patch[field]
    }
    host.localStorage.setItem(key, JSON.stringify(next))
    host.dispatchEvent(new Event(changed))
    return { success: true }
  } catch (error) { return { error: error.message || 'Could not save performance settings' } }
}

export function onBrowserPerformanceSettings(listener, host = globalThis.window) {
  const local = () => listener(loadBrowserPerformanceSettings(host))
  const storage = event => { if (event.key === key || event.key === null) local() }
  host.addEventListener(changed, local)
  host.addEventListener('storage', storage)
  return () => {
    host.removeEventListener(changed, local)
    host.removeEventListener('storage', storage)
  }
}
