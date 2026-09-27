// What happens to each file once yt-dlp has moved it into place, before it is
// indexed: lyrics looked up and written into it, the cover squared, the title
// tidied. Lyrics come from the user's own lyrics sources, in their order,
// minus "Local file" (that's this file, which has none yet).

const fs = require('fs')
const path = require('path')
const { readInfo, applyTags, stripArtistPrefix } = require('./tagger')
const { toPortableLyrics, toPrivateTag } = require('../lyrics/embedded')
const { isYouTube } = require('./args')

const LYRICS_TIMEOUT_MS = 30000

function withTimeout(promise, ms) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms)
    promise.then(v => { clearTimeout(timer); resolve(v) }, () => { clearTimeout(timer); resolve(null) })
  })
}

async function findLyrics(db, info, signal) {
  const service = require('../lyrics/service')
  const { lookup } = require('../lyrics/repository')
  const settings = service.readSettings(db)
  const enabled = settings.enabled.filter(id => id !== 'local')
  if (!enabled.length) return null
  const { result } = await lookup(
    { title: info.title, artist: info.artist, album: info.album, duration: info.duration || 0, filePath: null, keepCommaArtists: settings.keepCommaArtists },
    { order: settings.order, enabled, prioritizeSyllable: settings.prioritizeSyllable, signal },
  )
  return result && !result.instrumental && result.lines?.length ? result : null
}

function renameWithoutArtist(filePath, artist) {
  const ext = path.extname(filePath)
  const base = path.basename(filePath, ext)
  const next = stripArtistPrefix(base, artist)
  if (!next || next === base) return filePath
  const target = path.join(path.dirname(filePath), next + ext)
  try {
    if (fs.existsSync(target)) return filePath
    fs.renameSync(filePath, target)
    return target
  } catch { return filePath }
}

/**
 * @returns {{ filePath: string, lyrics: string|null, lyricsSource: string|null, cover: boolean }}
 */
async function finishFile(filePath, { db, settings = {}, url }) {
  const out = { filePath, lyrics: null, lyricsSource: null, cover: false }
  const info = readInfo(filePath)
  if (!info) return out
  const clean = settings.clean_download_metadata !== '0'
  const lookupInfo = { ...info, title: clean ? stripArtistPrefix(info.title, info.artist) : info.title }

  let lyrics = null
  if (settings.download_embed_lyrics !== '0' && !info.hasLyrics && lookupInfo.title && lookupInfo.artist && db) {
    const controller = new AbortController()
    lyrics = await withTimeout(findLyrics(db, lookupInfo, controller.signal), LYRICS_TIMEOUT_MS)
    controller.abort()
  }

  const changes = { cleanTitle: clean, squareCover: isYouTube(url) }
  if (lyrics) {
    changes.lyrics = toPortableLyrics(lyrics)
    changes.privateLyrics = toPrivateTag(lyrics)
  }
  const done = await applyTags(filePath, changes)
  if (done.lyrics) { out.lyrics = lyrics.sync; out.lyricsSource = lyrics.source }
  out.cover = done.cover
  if (clean) out.filePath = renameWithoutArtist(filePath, info.artist)
  return out
}

module.exports = { finishFile, findLyrics }
