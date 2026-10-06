// Import a playlist from a link (YouTube, SoundCloud, Bandcamp...) into a Lokal playlist.
// Shared by the desktop IPC (electron/ipc/playlists.js) and the web routes
// (server/routes/playlists.js). Nothing here runs for ordinary downloads.

const { spawn } = require('child_process')
const { cookieArgs } = require('../ipc/ytCookies')
const { jsRuntime } = require('../online/jsRuntime')
const { isYouTube } = require('../download/args')
const { sourceIdentity } = require('../online/sources')

const MAX_ENTRIES = 500
const FETCH_TIMEOUT_MS = 120000
const UNAVAILABLE = /^\[?(?:deleted|private|unavailable) video\]?$/i

function text(value, max) {
  const out = String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim()
  return out ? out.slice(0, max) : ''
}

function httpUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return /^https?:$/.test(url.protocol) && url.href.length <= 1000 ? url.href : null
  } catch {
    return null
  }
}

function playlistLinkProblem(link) {
  let url
  try { url = new URL(String(link || '').trim()) } catch { return 'Paste a link to a playlist.' }
  if (!/^https?:$/.test(url.protocol)) return 'Only http(s) links can be imported.'
  if (isYouTube(url.href)) {
    const list = url.searchParams.get('list') || ''
    if (!list) return "That link isn't a playlist. Open the playlist and copy its link."
    if (list.startsWith('RD')) return 'Mixes and radios are endless and made up for the listener. Pick a real playlist instead.'
  }
  return null
}

function cleanArtist(name) {
  return String(name || '').replace(/\s+-\s+Topic$/i, '').replace(/VEVO$/i, '').trim()
}

function platformOf(link) {
  try {
    const host = new URL(link).hostname.replace(/^(?:www|m|music)\./, '')
    if (host === 'youtu.be' || /(^|\.)youtube\.com$/.test(host)) return 'youtube'
    if (/(^|\.)soundcloud\.com$/.test(host)) return 'soundcloud'
    if (/(^|\.)bandcamp\.com$/.test(host)) return 'bandcamp'
  } catch {}
  return 'link'
}

function entryLink(raw, playlistIsYouTube) {
  const id = String(raw.id || '')
  if (/^[\w-]{11}$/.test(id) && (playlistIsYouTube || /^youtube/i.test(String(raw.ie_key || '')))) return `https://www.youtube.com/watch?v=${id}`
  return httpUrl(raw.webpage_url) || httpUrl(raw.url)
}

function normalizeEntry(raw, { fallbackArtist = '', playlistIsYouTube = false } = {}) {
  if (!raw || typeof raw !== 'object') return null
  const rawTitle = text(raw.track || raw.title, 300)
  if (!rawTitle || UNAVAILABLE.test(rawTitle)) return null
  const sourceUrl = entryLink(raw, playlistIsYouTube)
  if (!sourceUrl) return null
  const listed = Array.isArray(raw.artists) ? raw.artists.join(', ') : ''
  const artist = text(cleanArtist(raw.artist || listed || raw.channel || raw.uploader || raw.creator || fallbackArtist), 300)
  let title = rawTitle
  if (artist && title.toLowerCase().startsWith(`${artist.toLowerCase()} - `)) title = title.slice(artist.length + 3).trim() || rawTitle
  const thumbs = Array.isArray(raw.thumbnails) ? raw.thumbnails.filter(t => t?.url) : []
  const duration = Number(raw.duration)
  return {
    key: sourceUrl,
    title,
    artist: artist || null,
    album: text(raw.album, 300) || null,
    duration: duration > 0 ? Math.round(duration) : null,
    thumbnail: httpUrl(raw.thumbnail) || httpUrl(thumbs[thumbs.length - 1]?.url),
    source_url: sourceUrl,
  }
}

function sanitizeEntries(list) {
  const seen = new Set()
  const out = []
  for (const item of Array.isArray(list) ? list.slice(0, MAX_ENTRIES * 2) : []) {
    const title = text(item?.title, 300)
    const sourceUrl = httpUrl(item?.source_url)
    if (!title || !sourceUrl || seen.has(sourceUrl)) continue
    seen.add(sourceUrl)
    const duration = Number(item.duration)
    out.push({
      key: sourceUrl,
      title,
      artist: text(item.artist, 300) || null,
      album: text(item.album, 300) || null,
      duration: duration > 0 ? Math.round(duration) : null,
      thumbnail: httpUrl(item.thumbnail),
      source_url: sourceUrl,
    })
    if (out.length >= MAX_ENTRIES) break
  }
  return out
}

function ytdlpError(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const line = [...lines].reverse().find(l => /^ERROR:/i.test(l)) || lines[lines.length - 1]
  return line ? line.replace(/^ERROR:\s*(?:\[[^\]]+\]\s*)?/i, '').slice(0, 300) : ''
}

function parsePlaylistJson(stdout, stderr, { url, limit = MAX_ENTRIES } = {}) {
  let data
  try { data = JSON.parse(stdout) } catch { return { error: ytdlpError(stderr) || 'Could not read that playlist.' } }
  const raw = Array.isArray(data?.entries) ? data.entries : []
  if (!raw.length) return { error: ytdlpError(stderr) || "That link has no tracks. Is it a playlist, and is it public (or are cookies set up in Settings)?" }
  const playlistIsYouTube = isYouTube(url || data.webpage_url || '')
  const fallbackArtist = playlistIsYouTube ? '' : cleanArtist(data.uploader || data.channel)
  const seen = new Set()
  const entries = []
  let skipped = 0
  for (const item of raw.slice(0, limit)) {
    const entry = normalizeEntry(item, { fallbackArtist, playlistIsYouTube })
    if (!entry || seen.has(entry.key)) { skipped++; continue }
    seen.add(entry.key)
    entries.push(entry)
  }
  return {
    title: text(data.title || data.playlist_title || data.album, 200) || null,
    owner: text(cleanArtist(data.uploader || data.channel), 200) || null,
    platform: platformOf(url || data.webpage_url || ''),
    entries,
    skipped,
    truncated: raw.length > limit,
  }
}

/** Reads a playlist's tracks with yt-dlp, without downloading anything. */
function fetchPlaylist({ ytdlp, url, settings = {}, limit = MAX_ENTRIES, track = p => p, timeoutMs = FETCH_TIMEOUT_MS }) {
  const problem = playlistLinkProblem(url)
  if (problem) return Promise.resolve({ error: problem })
  if (!ytdlp) return Promise.resolve({ error: 'yt-dlp not found. Go to Settings -> External Tools to download it or set a custom path.' })
  const link = String(url).trim()
  const cookies = cookieArgs(settings, { url: link })
  const runtime = isYouTube(link) ? jsRuntime() : { args: [], options: {} }
  const args = [
    '--flat-playlist', '--dump-single-json', '--yes-playlist', '--ignore-errors', '--no-warnings',
    '--playlist-end', String(limit + 1),
    ...cookies.args, ...runtime.args,
    '--', link,
  ]
  return new Promise((resolve) => {
    let proc
    try { proc = track(spawn(ytdlp, args, { windowsHide: true, ...runtime.options })) } catch {
      resolve({ error: 'Failed to run yt-dlp' })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; try { proc.kill('SIGKILL') } catch {} }, timeoutMs)
    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('error', () => { clearTimeout(timer); resolve({ error: 'Failed to run yt-dlp' }) })
    proc.on('close', () => {
      clearTimeout(timer)
      resolve(timedOut ? { error: 'Reading that playlist took too long.' } : parsePlaylistJson(stdout, stderr, { url: link, limit }))
    })
  })
}

function libraryMatch(db, entry, findTrack) {
  const identity = sourceIdentity(entry.source_url)
  if (identity) {
    const owned = db.prepare("SELECT id FROM tracks WHERE source_ref = ? AND file_path NOT LIKE 'ghost://%' LIMIT 1").get(identity)
    if (owned) return owned
  }
  return findTrack(db, entry)
}

function existingGhost(db, entry) {
  return db.prepare("SELECT id FROM tracks WHERE source_url = ? AND file_path LIKE 'ghost://%' LIMIT 1").get(entry.source_url) || null
}

/** Which of these songs are already in the library (or already streamed), for the preview list. */
function previewEntries(db, entries, { findTrack }) {
  let matched = 0
  const rows = entries.map((entry) => {
    const owned = libraryMatch(db, entry, findTrack)
    const ghost = !owned && existingGhost(db, entry)
    if (owned) matched++
    return { ...entry, status: owned ? 'In library' : ghost ? 'Already added as a ghost' : 'New ghost song' }
  })
  return { rows, matched, ghostable: rows.length - matched }
}

/**
 * Makes a playlist from `entries`: songs already in the library are used as
 * they are, the rest become ghost songs (streamable from their link, and
 * replaced by the file if one is downloaded later).
 */
function importLinkEntries(db, { name, userId, entries, helpers, platform = 'link' }) {
  const { findTrack, createGhostTrack } = helpers
  const uid = userId || 'guest'
  const playlistId = `pl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const result = { playlistId, name, total: entries.length, matched: 0, ghosted: 0, reused: 0, duplicates: 0, ghosts: [] }
  const insert = db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
  db.transaction(() => {
    db.prepare('INSERT INTO playlists (id, name, user_id) VALUES (?, ?, ?)').run(playlistId, name, uid)
    const added = new Set()
    let position = 0
    for (const entry of entries) {
      let trackId
      let kind
      const owned = libraryMatch(db, entry, findTrack)
      if (owned) { trackId = owned.id; kind = 'matched' }
      else {
        const ghost = existingGhost(db, entry)
        if (ghost) { trackId = ghost.id; kind = 'reused' }
        else {
          const created = createGhostTrack(db, entry, platform, playlistId)
          trackId = created.id
          kind = 'ghosted'
          result.ghosts.push({ trackId, source_url: entry.source_url, title: entry.title, artist: entry.artist })
        }
      }
      if (added.has(trackId)) { result.duplicates++; continue }
      added.add(trackId)
      insert.run(playlistId, trackId, ++position, uid, Date.now())
      result[kind]++
    }
  })()
  return result
}

/** Queues a download for each ghost song (opt-in); the file replaces the ghost in the playlist. */
function queueGhostDownloads(manager, ghosts) {
  const { knownTagsOf } = require('../download/postprocess')
  let queued = 0
  let failed = 0
  for (const ghost of ghosts) {
    const result = manager.enqueue('single', ghost.source_url, {
      title: ghost.title,
      from: 'Playlist import',
      replaceTrackId: ghost.trackId,
      tags: knownTagsOf({ title: ghost.title, artist: ghost.artist }),
    })
    if (result?.error && !result.alreadyInLibrary) failed++
    else queued++
  }
  return { queued, failed }
}

module.exports = {
  MAX_ENTRIES,
  playlistLinkProblem,
  normalizeEntry,
  sanitizeEntries,
  parsePlaylistJson,
  fetchPlaylist,
  previewEntries,
  importLinkEntries,
  queueGhostDownloads,
  platformOf,
}
