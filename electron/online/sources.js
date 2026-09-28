// Online sources for search results that aren't in the library, played
// through the user's own yt-dlp:
//
//   yt  YouTube Music (youtube.js): its own Songs search, full tracks
//   sc  SoundCloud (soundcloud.js): yt-dlp search, progressive MP3; Go+
//       tracks only give a 30-second preview
//
// Shared by the desktop app (IPC + lokal-stream://<provider>/<id>) and the web
// server (/api/online). An online song that's played, liked or added to a
// playlist is kept as a ghost track (ghost://<platform>/online/<id>), so
// playlists, likes and history work as for any track, while the library,
// albums, artists and mixes keep ignoring it. Saving it to the library swaps
// the ghost for the downloaded file.

const yt = require('./youtube')
const sc = require('./soundcloud')

const PROVIDERS = {
  yt: { id: 'yt', label: 'YouTube Music', platform: 'youtube', idPattern: /^[\w-]{11}$/, sourceUrl: id => `https://music.youtube.com/watch?v=${id}` },
  sc: { id: 'sc', label: 'SoundCloud', platform: 'soundcloud', idPattern: /^\d{1,20}$/, sourceUrl: id => sc.trackUrl(id) },
}
const PLATFORM_TO_PROVIDER = { youtube: 'yt', soundcloud: 'sc' }

/** A known provider, or null. */
function providerOf(id) {
  return PROVIDERS[id] || null
}

/** Is `id` a well-formed item id for `provider`? */
function validId(provider, id) {
  const p = providerOf(provider)
  return !!p && p.idPattern.test(String(id || ''))
}

// ---------------------------------------------------------------- search

/** YouTube Music results in the shared shape ({ provider, id, ... }). */
function fromYouTube(r) {
  return { ...r, provider: 'yt', id: r.videoId }
}

/**
 * Songs for `query` on one provider. YouTube Music falls back to plain
 * YouTube search through yt-dlp if YouTube Music can't be reached.
 * @param fallbackSearch (query) => Promise<results in the yt shape>, optional
 */
async function search(provider, query, { ytdlp, fetchImpl, fallbackSearch, limit = 10 } = {}) {
  if (provider === 'sc') return { results: await sc.searchTracks(query, { ytdlp, limit }) }
  try {
    return { results: (await yt.searchSongs(query, { limit, fetchImpl })).map(fromYouTube) }
  } catch (e) {
    if (!fallbackSearch) throw e
    return { fallback: true, results: (await fallbackSearch(query)).map(fromYouTube) }
  }
}

// ---------------------------------------------------------------- streams

/** Resolve (or reuse) the stream of an item. */
function resolveStream(provider, id, opts = {}) {
  if (!validId(provider, id)) return Promise.reject(new Error('Unknown online song'))
  return provider === 'sc' ? sc.resolveStream(id, opts) : yt.resolveStream(id, opts)
}

/**
 * Fetch (a range of) the audio of an item. A refused URL (expired, or tied to
 * another address) is looked up again once.
 */
async function fetchStream(provider, id, { range, fetchImpl = fetch, ...opts } = {}) {
  const attempt = async (force) => {
    const stream = await resolveStream(provider, id, { ...opts, force })
    const headers = { ...stream.headers }
    if (range) headers.Range = range
    return { stream, res: await fetchImpl(stream.url, { headers }) }
  }
  let { stream, res } = await attempt(false)
  if (res.status === 403 || res.status === 410) {
    try { await res.body?.cancel?.() } catch {}
    ;({ stream, res } = await attempt(true))
  }
  return { res, mime: stream.mime, preview: !!stream.preview }
}

// ---------------------------------------------------------------- tracks

/** Library id of an online song. */
function onlineTrackId(provider, id) {
  return `${provider}-${id}`
}

/** Where a track can be streamed from ({ provider, id }), or null. */
function streamRef(track) {
  const path = String(track?.file_path || '')
  const own = path.match(/^ghost:\/\/(youtube|soundcloud)\/online\/([\w-]+)$/)
  if (own) {
    const provider = PLATFORM_TO_PROVIDER[own[1]]
    return validId(provider, own[2]) ? { provider, id: own[2] } : null
  }
  if (!path.startsWith('ghost://')) return null
  const videoId = yt.videoIdFromUrl(track?.source_url)
  if (videoId) return { provider: 'yt', id: videoId }
  const trackId = sc.idFromUrl(track?.source_url)
  return trackId ? { provider: 'sc', id: trackId } : null
}

/**
 * What a download URL points at, to check that a download really is the
 * song a ghost track stands for: "yt:<videoId>", "sc:<trackId>", or null.
 */
function sourceIdentity(url) {
  const videoId = yt.videoIdFromUrl(url)
  if (videoId) return `yt:${videoId}`
  const trackId = sc.idFromUrl(url)
  return trackId ? `sc:${trackId}` : null
}

/**
 * Keep online songs as ghost tracks, so they can be played, liked and added
 * to playlists. Returns the track rows (null for unusable items), in order.
 */
function saveOnlineTracks(db, items = []) {
  const upsert = db.prepare(`
    INSERT INTO tracks (id, file_path, file_hash, title, artist, album, album_artist, duration, source_url, artwork_url, last_modified)
    VALUES (@id, @file_path, @id, @title, @artist, @album, @album_artist, @duration, @source_url, @artwork_url, @now)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, artist = excluded.artist, album = excluded.album,
      album_artist = excluded.album_artist, duration = excluded.duration,
      source_url = excluded.source_url, artwork_url = excluded.artwork_url
    WHERE tracks.file_path LIKE 'ghost://%'
  `)
  const get = db.prepare('SELECT * FROM tracks WHERE id = ?')
  const run = db.transaction((list) => list.map(item => {
    // Older callers sent YouTube items as { videoId }.
    const provider = item?.provider || (item?.videoId ? 'yt' : null)
    const itemId = String(item?.id && item?.provider ? item.id : item?.videoId || '')
    if (!validId(provider, itemId)) return null
    const p = providerOf(provider)
    const id = onlineTrackId(provider, itemId)
    upsert.run({
      id,
      file_path: `ghost://${p.platform}/online/${itemId}`,
      title: String(item.title || 'Unknown Track').slice(0, 500),
      artist: String(item.artist || (item.artists || []).join(', ') || 'Unknown Artist').slice(0, 500),
      album: item.album ? String(item.album).slice(0, 500) : null,
      album_artist: item.artists?.[0] ? String(item.artists[0]).slice(0, 500) : null,
      duration: Number(item.duration) > 0 ? Number(item.duration) : null,
      source_url: p.sourceUrl(itemId),
      artwork_url: /^https:\/\//.test(String(item.thumbnail || '')) ? String(item.thumbnail).slice(0, 1000) : null,
      now: Date.now(),
    })
    return get.get(id)
  }))
  return run(Array.isArray(items) ? items.slice(0, 100) : [])
}

/**
 * Forget online songs nobody kept: played from a search but never liked,
 * added to a playlist or listened to for long enough to count, after a week.
 */
function pruneOnlineTracks(db, maxAgeMs = 7 * 24 * 3600 * 1000) {
  try {
    const prune = db.transaction((cutoff) => {
      const ids = db.prepare(`
        SELECT id FROM tracks
        WHERE (file_path LIKE 'ghost://youtube/online/%' OR file_path LIKE 'ghost://soundcloud/online/%')
          AND COALESCE(last_modified, 0) < ?
          AND id NOT IN (SELECT track_id FROM playlist_tracks)
          AND id NOT IN (SELECT track_id FROM user_likes)
          AND id NOT IN (SELECT track_id FROM play_history)
      `).all(cutoff).map(row => row.id)

      for (const id of ids) {
        db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(id)
        db.prepare('DELETE FROM listening_events WHERE track_id = ?').run(id)
        db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(id)
        try { db.prepare('DELETE FROM lyrics_translations WHERE track_id = ?').run(id) } catch {}
        db.prepare('DELETE FROM tracks WHERE id = ?').run(id)
      }
      return ids.length
    })
    return prune(Date.now() - maxAgeMs)
  } catch { return 0 }
}

module.exports = {
  PROVIDERS, providerOf, validId,
  search, resolveStream, fetchStream,
  onlineTrackId, streamRef, sourceIdentity, saveOnlineTracks, pruneOnlineTracks,
}
