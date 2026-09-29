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

// ---------------------------------------------------------------- known tags
// A song saved from an addon comes from a bare audio link: no title, artist
// or cover in it, and yt-dlp names it after the link ("7779369"). What the
// addon said about the song (its search result) is passed along instead: its
// title and artist replace yt-dlp's guesses, its album and cover fill in
// whatever the file itself doesn't have.

const COVER_MAX_BYTES = 5 * 1024 * 1024
const COVER_TIMEOUT_MS = 10000

/** Tags for a download from the client, checked: { title, artist, album, cover } or undefined. */
function knownTagsOf(value) {
  if (!value || typeof value !== 'object') return undefined
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().replace(/[\u0000-\u001f]/g, ' ').slice(0, 300) : undefined)
  const tags = {
    title: text(value.title),
    artist: text(value.artist),
    album: text(value.album),
    cover: typeof value.cover === 'string' && /^https:\/\/[^\s]{1,1000}$/.test(value.cover) ? value.cover : undefined,
  }
  return tags.title || tags.artist ? tags : undefined
}

/** The cover image at `url` (https, an image, 5 MB at most), or null. */
async function fetchCover(url) {
  if (!url) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), COVER_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    const mime = String(res.headers.get('content-type') || '').split(';')[0].trim()
    if (!res.ok || !/^image\/(?:jpeg|png|webp)$/.test(mime)) return null
    if (Number(res.headers.get('content-length')) > COVER_MAX_BYTES) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    return bytes.length && bytes.length <= COVER_MAX_BYTES ? { bytes, mime } : null
  } catch { return null } finally { clearTimeout(timer) }
}

/**
 * @param known  tags the source gave for the song ({ title, artist, album, cover }),
 *               used where the file has none
 * @returns {{ filePath: string, lyrics: string|null, lyricsSource: string|null, cover: boolean }}
 */
async function finishFile(filePath, { db, settings = {}, url, meta = null, kind = 'single', outputDir = null, known = null }) {
  const out = { filePath, lyrics: null, lyricsSource: null, cover: false }
  const info = readInfo(filePath)
  if (!info) return out
  if (known) return finishKnownFile(filePath, info, { db, settings, known, outputDir, out })
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

/** finishFile for a file whose song is known from its source (an addon). */
async function finishKnownFile(filePath, info, { db, settings, known, outputDir, out }) {
  // yt-dlp tags a bare link with its own guesses, written over anything the
  // file had: the title is the link's file name ("7779369") and the artist
  // "Unknown Artist" (or the host). So the addon's title and artist win.
  // The album isn't guessed: one already in the file is kept.
  const tags = {
    title: known.title || info.title || '',
    artist: known.artist || info.artist || '',
    album: info.album || known.album || '',
  }
  const changes = {}
  if (known.title && known.title !== info.title) changes.title = known.title
  if (known.artist && known.artist !== info.artist) changes.artist = known.artist
  if (!info.album && known.album) changes.album = known.album
  const cover = known.cover ? await fetchCover(known.cover) : null
  if (cover) { changes.coverBytes = cover.bytes; changes.coverMime = cover.mime }

  if (settings.download_embed_lyrics !== '0' && !info.hasLyrics && tags.title && tags.artist && db) {
    const controller = new AbortController()
    const lyrics = await withTimeout(findLyrics(db, { ...info, ...tags }, controller.signal), LYRICS_TIMEOUT_MS)
    controller.abort()
    if (lyrics) {
      changes.lyrics = toPortableLyrics(lyrics)
      changes.privateLyrics = toPrivateTag(lyrics)
      out.lyrics = lyrics.sync
      out.lyricsSource = lyrics.source
    }
  }
  const done = await applyTags(filePath, changes)
  if (!done.lyrics) { out.lyrics = null; out.lyricsSource = null }
  out.cover = done.cover
  out.artist = tags.artist || undefined
  // Named and filed like any single: Music/Artist/Album/Title.ext.
  out.filePath = tags.title ? refile(filePath, { artist: tags.artist, title: tags.title, album: tags.album, outputDir }) : filePath
  return out
}

module.exports = { finishFile, findLyrics, artistAndTitle, knownTagsOf }
