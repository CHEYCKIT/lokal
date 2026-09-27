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

// ---------------------------------------------------------------- who sang it
// A YouTube video's channel is often not the artist: labels, VEVO accounts,
// fan uploads. The title usually is: "Artist - Song (Official Video)". The
// catalogue itself (YouTube Music, "Artist - Topic" channels) is trusted as-is:
// its titles are just the song, and a dash there belongs to the song
// ("Song - Remastered 2011").

const DASH = /^(.{1,80}?)\s+[-–—|]\s+(.+)$/
const NOT_AN_ARTIST = /^(?:official|lyrics?|audio|video|full album|live|remix|remastered|\d{4})$/i

function unquote(s) {
  return String(s || '').trim().replace(/^["'“”‘’«]+|["'“”‘’»]+$/g, '').trim()
}

/** { artist, title } from the video, or null to keep what the tags say. */
function artistAndTitle(meta, tags) {
  if (!meta) return null
  const channel = String(meta.channel || meta.uploader || '')
  if (meta.track || /\s-\sTopic$/i.test(channel)) return null
  const title = String(tags.title || meta.title || '').trim()
  const m = title.match(DASH)
  if (!m) return null
  const artist = unquote(m[1])
  const song = unquote(m[2])
  if (!artist || !song || NOT_AN_ARTIST.test(artist)) return null
  return { artist, title: song }
}

function safeName(s) {
  return String(s || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 120)
}

/** Singles live in Music/Artist/Album; move one whose artist changed. */
function refile(filePath, { artist, title, album, outputDir }) {
  const ext = path.extname(filePath)
  const dir = outputDir && artist ? path.join(outputDir, safeName(artist), safeName(album) || 'Singles') : path.dirname(filePath)
  let target = path.join(dir, `${safeName(title) || path.basename(filePath, ext)}${ext}`)
  if (target === filePath) return filePath
  for (let n = 1; fs.existsSync(target) && n < 50; n++) target = path.join(dir, `${safeName(title)} (${n})${ext}`)
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.renameSync(filePath, target)
    // Leave no empty "Channel/Singles" folders behind.
    for (let d = path.dirname(filePath), i = 0; i < 2 && d !== outputDir; i++, d = path.dirname(d)) {
      try { if (!fs.readdirSync(d).length) fs.rmdirSync(d); else break } catch { break }
    }
    return target
  } catch { return filePath }
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
async function finishFile(filePath, { db, settings = {}, url, meta = null, kind = 'single', outputDir = null }) {
  const out = { filePath, lyrics: null, lyricsSource: null, cover: false }
  const info = readInfo(filePath)
  if (!info) return out
  const clean = settings.clean_download_metadata !== '0'
  // "Artist - Song" videos: the artist is in the title, not the channel.
  const fromTitle = clean && isYouTube(url) ? artistAndTitle(meta, info) : null
  const lookupInfo = fromTitle
    ? { ...info, ...fromTitle }
    : { ...info, title: clean ? stripArtistPrefix(info.title, info.artist) : info.title }

  let lyrics = null
  if (settings.download_embed_lyrics !== '0' && !info.hasLyrics && lookupInfo.title && lookupInfo.artist && db) {
    const controller = new AbortController()
    lyrics = await withTimeout(findLyrics(db, lookupInfo, controller.signal), LYRICS_TIMEOUT_MS)
    controller.abort()
  }

  const changes = { cleanTitle: clean && !fromTitle, squareCover: isYouTube(url) }
  if (fromTitle) { changes.title = fromTitle.title; changes.artist = fromTitle.artist }
  if (lyrics) {
    changes.lyrics = toPortableLyrics(lyrics)
    changes.privateLyrics = toPrivateTag(lyrics)
  }
  const done = await applyTags(filePath, changes)
  if (done.lyrics) { out.lyrics = lyrics.sync; out.lyricsSource = lyrics.source }
  out.cover = done.cover
  if (fromTitle && (done.title || done.artist)) {
    out.artist = fromTitle.artist
    out.filePath = kind === 'single'
      ? refile(filePath, { ...fromTitle, album: info.album, outputDir })
      : refile(filePath, { title: fromTitle.title }) // playlists keep their folder
  } else if (clean) out.filePath = renameWithoutArtist(filePath, info.artist)
  return out
}

module.exports = { finishFile, findLyrics, artistAndTitle }
