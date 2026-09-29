// Online sources for search results that aren't in the library, played
// through the user's own yt-dlp:
//
//   yt  YouTube Music (youtube.js): its own Songs search, full tracks
//   sc  SoundCloud (soundcloud.js): yt-dlp search, progressive MP3; Go+
//       tracks only give a 30-second preview
//   a-<key>  addons the user installed from a manifest URL (addons.js)
//
// Shared by the desktop app (IPC + lokal-stream://<provider>/<id>) and the web
// server (/api/online). An online song that's played, liked or added to a
// playlist is kept as a ghost track (ghost://<platform>/online/<id>), so
// playlists, likes and history work as for any track, while the library,
// albums, artists and mixes keep ignoring it. Saving it to the library swaps
// the ghost for the downloaded file.

const crypto = require('crypto')
const yt = require('./youtube')
const sc = require('./soundcloud')
const addons = require('./addons')

const PROVIDERS = {
  yt: { id: 'yt', label: 'YouTube Music', platform: 'youtube', idPattern: /^[\w-]{11}$/, sourceUrl: id => `https://music.youtube.com/watch?v=${id}` },
  sc: { id: 'sc', label: 'SoundCloud', platform: 'soundcloud', idPattern: /^\d{1,20}$/, sourceUrl: id => sc.trackUrl(id) },
}
const PLATFORM_TO_PROVIDER = { youtube: 'yt', soundcloud: 'sc' }

/** A built-in provider, or an addon provider ("a-<key>"), or null. */
function providerOf(id) {
  if (PROVIDERS[id]) return PROVIDERS[id]
  const key = addons.keyOfProvider(id)
  return key ? { id, addonKey: key, platform: 'addon', idPattern: /^[^\n\r]{1,300}$/, sourceUrl: () => null } : null
}

/** Is `id` a well-formed item id for `provider`? */
function validId(provider, id) {
  const p = providerOf(provider)
  return !!p && p.idPattern.test(String(id ?? ''))
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
async function search(provider, query, { db, ytdlp, fetchImpl, fallbackSearch, limit = 10 } = {}) {
  const key = addons.keyOfProvider(provider)
  if (key) return { results: await addons.search(db, key, query, { fetchImpl, limit: 20 }) }
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
  const key = addons.keyOfProvider(provider)
  if (key) return addons.resolveStream(opts.db, key, id, { force: opts.force, fetchImpl: opts.addonFetch })
  return provider === 'sc' ? sc.resolveStream(id, opts) : yt.resolveStream(id, opts)
}

// How long an addon's media server may take to start answering (per
// attempt; resolving the stream has its own timeout in addons.js).
const ADDON_MEDIA_TIMEOUT_MS = 20000

/** Fetch an addon's media: checked redirects, a timeout, and cancelled with `signal`. */
async function fetchAddonMedia(url, { fetchImpl, headers, signal }) {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  // The player went away (skipped, closed): stop fetching, body included.
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener?.('abort', cancel, { once: true })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, ADDON_MEDIA_TIMEOUT_MS)
  try {
    return await addons.fetchChecked(url, { fetchImpl, headers, signal: controller.signal })
  } catch (e) {
    signal?.removeEventListener?.('abort', cancel)
    if (timedOut) throw new Error("The addon's audio server took too long to answer.")
    throw e
  } finally {
    // Only the wait for the answer is timed: the song itself streams as long as it lasts.
    clearTimeout(timer)
  }
}

/**
 * Fetch (a range of) the audio of an item. A refused URL (expired, or tied to
 * another address) is looked up again once. `signal`: aborts an addon's media
 * request when the one who asked for it goes away.
 */
async function fetchStream(provider, id, { range, fetchImpl = fetch, signal, ...opts } = {}) {
  const attempt = async (force) => {
    const stream = await resolveStream(provider, id, { ...opts, force })
    const headers = { ...stream.headers }
    if (range) headers.Range = range
    // An addon's media URL is the addon's to choose: follow its redirects one
    // at a time, each checked like the addon's own URLs (https, or http on
    // this machine / network only). Built-in providers fetch directly.
    if (addons.keyOfProvider(provider)) return { stream, res: await fetchAddonMedia(stream.url, { fetchImpl, headers, signal }) }
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

/** Library id of an online song (addon ids can be anything, so they're hashed). */
function onlineTrackId(provider, id) {
  if (addons.keyOfProvider(provider)) return `${provider}-${crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 16)}`
  return `${provider}-${id}`
}

/** ghost:// path of an online song. */
function ghostPath(provider, id) {
  const key = addons.keyOfProvider(provider)
  if (key) return `ghost://addon/${key}/${encodeURIComponent(id)}`
  return `ghost://${providerOf(provider).platform}/online/${id}`
}

/** Where a track can be streamed from ({ provider, id }), or null. */
function streamRef(track) {
  const path = String(track?.file_path || '')
  const fromAddon = path.match(/^ghost:\/\/addon\/([0-9a-f]{10})\/(.+)$/)
  if (fromAddon) {
    try { return { provider: addons.providerFor(fromAddon[1]), id: decodeURIComponent(fromAddon[2]) } } catch { return null }
  }
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

// ------------------------------------------------------ the same song, streamed
// Liking (or adding to a playlist) a streamed song, then downloading it from
// anywhere else (another result, an addon, Soulseek, the Download page) left
// both copies in likes and playlists. These find a new file's streamed twins:
// same title and lead artist, lengths within a few seconds. Noise such as
// "(Official Video)" or "(feat. …)" is ignored; "(Remix)", "(Live)", "(… Edit)"
// are not (nor "(Official Remix)", "(Official Live Video)"), so another
// version is never taken for the original. Both lengths must be known.
const NOISE_TAG = /^(?:official(?: (?:music|lyric|hd|4k))?(?: (?:video|audio|visuali[sz]er))?|lyrics?(?: video)?|lyric video|audio|video|music video|visuali[sz]er|hd|hq|4k|mv|explicit|clean|remaster(?:ed)?(?: \d{4})?|\d{4} remaster(?:ed)?|(?:feat|ft|featuring|with)\b.*)$/i
const TWIN_DURATION_SLACK_S = 5

const plainKey = (s) => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function titleKey(title) {
  return plainKey(String(title || '').replace(/\s*[([]([^()[\]]*)[)\]]/g, (group, inner) => (NOISE_TAG.test(inner.trim()) ? '' : group)))
}

function leadArtistKey(artist) {
  // "A (feat. B)" / "A [with B]": the credit in brackets goes first.
  const credited = String(artist || '').replace(/\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^()[\]]*[)\]]/gi, '')
  const lead = credited.split(/\s+(?:feat\.?|ft\.?|featuring|with|x|vs\.?)\s+|\s+&\s+|,\s*/i)[0]
  return plainKey(lead.replace(/\s*-\s*topic$/i, ''))
}

/** Ids of liked or playlisted streamed tracks that are the same song as `track`. */
function streamedTwins(db, track) {
  const artist = leadArtistKey(track?.artist)
  // "Artist - Song" video titles carry the artist: compare the song part.
  const songOf = (key, who) => (key.startsWith(`${who} `) ? key.slice(who.length + 1) : key)
  const song = songOf(titleKey(track?.title), artist)
  if (!artist || !song) return []
  const ghosts = db.prepare(`
    SELECT id, title, artist, duration FROM tracks
    WHERE file_path LIKE 'ghost://%'
      AND (id IN (SELECT track_id FROM user_likes) OR id IN (SELECT track_id FROM playlist_tracks))
  `).all()
  const length = Number(track.duration) || 0
  return ghosts.filter(ghost => {
    if (leadArtistKey(ghost.artist) !== artist) return false
    if (songOf(titleKey(ghost.title), artist) !== song) return false
    const other = Number(ghost.duration) || 0
    // An unknown length could be any version: leave that one alone.
    return length > 0 && other > 0 && Math.abs(length - other) <= TWIN_DURATION_SLACK_S
  }).map(ghost => ghost.id)
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
      file_path: ghostPath(provider, itemId),
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
        WHERE (file_path LIKE 'ghost://youtube/online/%' OR file_path LIKE 'ghost://soundcloud/online/%' OR file_path LIKE 'ghost://addon/%')
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
  PROVIDERS, providerOf, validId, ghostPath, addons,
  search, resolveStream, fetchStream,
  onlineTrackId, streamRef, sourceIdentity, saveOnlineTracks, pruneOnlineTracks, streamedTwins,
}
