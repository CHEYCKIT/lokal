// Unison: a community-submitted database -- contributed rather than licensed,
// so it occasionally has a track none of the catalogues do. Answers with TTML,
// (enhanced) LRC or plain text, and says which.

const { getJson, withQuery } = require('../http')

async function fetch(query, ctx = {}) {
  const url = withQuery('https://unison.boidu.dev/lyrics', {
    song: query.searchTitle || query.title,
    artist: query.searchArtist || query.artist,
    album: query.album,
    duration: query.duration ? Math.round(query.duration) : undefined,
  })
  const body = await getJson(url, { signal: ctx.signal })
  const lyrics = body?.success ? body?.data?.lyrics : null
  if (!lyrics || !String(lyrics).trim()) return null
  if (String(body.data.syncType).toLowerCase() === 'plain') {
    return { lines: String(lyrics).split('\n').map(t => t.trim()).filter(Boolean).map(text => ({ text, time: null, words: [] })) }
  }
  return { raw: lyrics }
}

module.exports = { fetch }
