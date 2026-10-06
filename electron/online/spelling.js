// A misspelt search ("micheal jackson"): corrected the library's way when
// the library has something close ("michael jackson"), else as YouTube
// Music corrects it. Nothing when the search finds library songs as typed.

const { searchTracks, correctSpelling } = require('../librarySearch')
const youtube = require('./youtube')

/** { corrected, source: 'library' | 'youtube' } or { corrected: null }. */
async function spelling(db, query, { fetchImpl } = {}) {
  const q = String(query || '').trim()
  if (q.length < 3) return { corrected: null }
  try { if (searchTracks(db, q, 1).length) return { corrected: null } } catch {}
  let fromLibrary = null
  try { fromLibrary = correctSpelling(db, q) } catch {}
  if (fromLibrary) return { corrected: fromLibrary, source: 'library' }
  const fromYouTube = await youtube.spellCheck(q, fetchImpl ? { fetchImpl } : undefined).catch(() => null)
  return fromYouTube ? { corrected: fromYouTube, source: 'youtube' } : { corrected: null }
}

module.exports = { spelling }
