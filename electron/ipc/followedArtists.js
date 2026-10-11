// Home → Releases → Followed artists: the artists you follow on Spotify, or
// those in your Apple Music library, to follow here too.
const { getDB } = require('./db')

function settingsMap() {
  return Object.fromEntries(getDB().prepare('SELECT key, value FROM settings').all().map(row => [row.key, row.value]))
}

async function linkedArtists(service) {
  try {
    const settings = settingsMap()
    if (service === 'spotify') return { names: await require('../artwork/spotify').followedArtists(settings.spotify_sp_dc) }
    if (service === 'appleMusic') return { names: await require('../online/appleMusic').libraryArtists(settings.apple_music_user_token) }
    return { error: 'Unknown service' }
  } catch (error) { return { error: error.message } }
}

function registerFollowedArtistsHandlers(ipcMain) {
  ipcMain.handle('artists:linkedFollows', (_, service) => linkedArtists(service))
}

module.exports = { registerFollowedArtistsHandlers, linkedArtists }
