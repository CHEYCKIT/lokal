/**
 * Tracks which "Simpler Artist Names" preference was last applied to scanned tags.
 * File mtimes do not change when this setting is toggled, so scans need a separate
 * checkpoint to decide when unchanged files must be parsed again.
 */
/** Returns the normalized artist-name preference used during scanning. */
function getArtistNamePreference(db) {
  const value = db.prepare("SELECT value FROM settings WHERE key = 'clean_download_metadata'").get()?.value
  return value === '0' ? '0' : '1'
}

/** Returns true if the saved library scan used a different artist-name preference. */
function artistNamePreferenceNeedsRescan(db, current = getArtistNamePreference(db)) {
  const scanned = db.prepare("SELECT value FROM settings WHERE key = 'artist_names_scan_preference'").get()?.value
  return scanned !== current
}

/** Records the artist-name preference applied by a completed scan. */
function rememberArtistNamePreference(db, preference = getArtistNamePreference(db)) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('artist_names_scan_preference', ?)").run(preference)
  return preference
}

/** Saves a preference only when every scan result completed without file errors. */
function rememberArtistNamePreferenceAfterScan(db, preference, result) {
  const results = Array.isArray(result) ? result : [result]
  if (!results.length || !results.every(item => item && !item.error && item.errors === 0)) return false
  rememberArtistNamePreference(db, preference)
  return true
}

module.exports = {
  getArtistNamePreference,
  artistNamePreferenceNeedsRescan,
  rememberArtistNamePreference,
  rememberArtistNamePreferenceAfterScan,
}
