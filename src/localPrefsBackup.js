// Interface preferences kept in this window's localStorage (track columns and
// their widths, sidebar widths and sizes, collapsed sidebar, Library sort and
// filters, the open tab and folder, EQ, side panels…), carried in the full
// app export so an import brings the app back looking the same. The database
// part of the export doesn't see these.

// Session state, caches, sign-ins and per-machine values stay out.
const SKIP = new Set([
  'lokal-queue',
  'lokal-user',
  'lokal-lastfm-auth-token',
  'lokal-lastfm-status-feed',
  'lokal-online-cache-v1',
  'lokal-downloads',
  'lokal-output-device',
])
const SKIP_PREFIXES = ['lokal-stream:']
const EXTRA_KEYS = new Set(['word-sync'])

const isBackedUp = key => (key.startsWith('lokal-') || EXTRA_KEYS.has(key))
  && !SKIP.has(key)
  && !SKIP_PREFIXES.some(prefix => key.startsWith(prefix))

/** The backed-up localStorage entries, as { key: rawString }. */
export function collectLocalPrefs() {
  const prefs = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !isBackedUp(key)) continue
      const value = localStorage.getItem(key)
      if (value !== null) prefs[key] = value
    }
  } catch {}
  return prefs
}

/**
 * Put a backup's preferences back. Only keys this app backs up are written,
 * so a hand-edited file can't plant anything else; the app is reloaded right
 * after an import, which picks them up.
 */
export function restoreLocalPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return 0
  let restored = 0
  try {
    for (const [key, value] of Object.entries(prefs)) {
      if (!isBackedUp(key) || typeof value !== 'string') continue
      localStorage.setItem(key, value)
      restored++
    }
  } catch {}
  return restored
}
