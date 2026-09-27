// lyrics.ovh: plain text only. The last resort before "no lyrics".

const { getJson } = require('../http')
const { parsePlain } = require('../lrc')

async function fetch(query, ctx = {}) {
  const artist = encodeURIComponent(query.searchArtist || query.artist || '')
  const title = encodeURIComponent(query.searchTitle || query.title || '')
  if (!artist || !title) return null
  const body = await getJson(`https://api.lyrics.ovh/v1/${artist}/${title}`, { signal: ctx.signal })
  if (!body?.lyrics) return null
  return { lines: parsePlain(body.lyrics) }
}

module.exports = { fetch }
