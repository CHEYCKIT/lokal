// Short, anonymous Home greetings derived from the listener's own recent history.
// This is intentionally computed from data Home already loads: no extra requests,
// no artist/title text in the greeting, and no persistent listening profile.

const CALM_GENRES = [
  'ambient', 'chill', 'lo-fi', 'lofi', 'slowcore', 'acoustic', 'classical',
  'jazz', 'dream pop', 'downtempo', 'instrumental', 'new age', 'soft rock',
]
const ENERGY_GENRES = [
  'techno', 'trance', 'drum and bass', 'dnb', 'metal', 'hardcore', 'punk',
  'hardstyle', 'dance', 'edm', 'breakbeat', 'electro', 'industrial',
]

function playedAtMs(entry) {
  const value = Number(entry?.played_at ?? entry?.scrobbledAt ?? 0)
  if (!Number.isFinite(value) || value <= 0) return 0
  return value > 1e12 ? value : value * 1000
}

function genresOf(entry) {
  const values = [entry?.genre, entry?.genres]
    .flatMap(value => Array.isArray(value) ? value : String(value || '').split(/[,;|]/))
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(values)]
}

function trackKey(entry) {
  if (entry?.id != null && String(entry.id)) return String(entry.id)
  return [entry?.artist, entry?.title].map(value => String(value || '').trim().toLowerCase()).join('\u0000')
}

function timeOfDay(hour) {
  if (hour < 12) return 'Ready for a fresh soundtrack?'
  if (hour < 18) return 'What sounds good this afternoon?'
  if (hour < 23) return 'Settling into your evening soundtrack?'
  return 'Keeping the late hours company?'
}

/**
 * Returns one short greeting line. Patterns are inferred from the latest 40
 * local listening-history entries; only the pattern is expressed, never a
 * track, artist, album or genre name.
 */
export function personalizedHomeGreeting(history = [], { hour = new Date().getHours(), now = Date.now() } = {}) {
  const currentHour = Number.isFinite(Number(hour)) ? Number(hour) : new Date(now).getHours()
  const recent = (Array.isArray(history) ? history : [])
    .map(entry => ({ entry, playedAt: playedAtMs(entry) }))
    .filter(item => item.playedAt > 0 && item.playedAt <= now + 5 * 60 * 1000)
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, 40)

  if (recent.length < 5) return timeOfDay(currentHour)

  // A repeat insight should reflect a current streak, not a few replays
  // scattered across a large window that can keep the message stuck for days.
  const trackCounts = new Map()
  for (const { entry } of recent.slice(0, 8)) {
    const key = trackKey(entry)
    if (key && key !== '\u0000') trackCounts.set(key, (trackCounts.get(key) || 0) + 1)
  }
  if (Math.max(0, ...trackCounts.values()) >= 3) return 'The repeat button has been getting a workout.'

  const tagged = recent.filter(item => genresOf(item.entry).length > 0)
  if (tagged.length >= 6) {
    const calm = tagged.filter(item => genresOf(item.entry).some(genre => CALM_GENRES.some(hint => genre.includes(hint)))).length
    const energetic = tagged.filter(item => genresOf(item.entry).some(genre => ENERGY_GENRES.some(hint => genre.includes(hint)))).length
    if (calm / tagged.length >= 0.55) return 'Your mellow side has been getting more play.'
    if (energetic / tagged.length >= 0.55) return 'High-energy listening has been winning lately.'
  }

  const timed = recent.slice(0, 30).map(item => ({ ...item, hour: new Date(item.playedAt).getHours() }))
  const night = timed.filter(item => item.hour >= 22 || item.hour < 5).length
  const morning = timed.filter(item => item.hour >= 5 && item.hour < 9).length
  if (timed.length >= 6 && night / timed.length >= 0.5) return 'Your after-dark listening rhythm is holding steady.'
  if (timed.length >= 6 && morning / timed.length >= 0.5) return 'You have a soundtrack for the early hours.'

  const activeDays = new Set(recent
    .filter(item => now - item.playedAt < 7 * 24 * 60 * 60 * 1000)
    .map(item => new Date(item.playedAt).toLocaleDateString()))
  if (activeDays.size >= 4) return 'Your listening streak has some momentum.'

  const artists = recent.map(item => String(item.entry?.artist || '').trim().toLowerCase()).filter(Boolean)
  if (artists.length >= 8 && new Set(artists).size / artists.length >= 0.8) {
    return 'Lots of different sounds in your rotation lately.'
  }

  return timeOfDay(currentHour)
}
