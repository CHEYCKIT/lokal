import { api } from './api.js'
import { DEFAULT_PLAYBACK_SOURCES, orderedPlaybackSources } from './playbackSources.js'
import { isPlayable, providerLabel, streamRef } from './onlineTracks.js'

export const recommendationKey = value => String(value || '').normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()
export const songKey = track => `${recommendationKey(track?.artist)}\0${recommendationKey(track?.title)}`
export const sourceName = source => source === 'youtube' ? 'YouTube Music' : 'Last.fm'

export async function mapLimited(items, callback, concurrency = 4) {
  const out = new Array(items.length)
  let index = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) { const at = index++; out[at] = await callback(items[at], at) }
  }))
  return out
}

export function uniqueSongs(items) {
  const seen = new Set()
  return (Array.isArray(items) ? items : []).filter(track => {
    if (!track?.title || !track?.artist) return false
    const key = songKey(track)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const stripFeatured = suffix => /\b(?:remix|live|cover)\b/i.test(recommendationKey(suffix)) ? suffix : ''
// The same recording under another label: "(2011 Remaster)", "- Remastered
// 2003", "- Single Version", "(Mono)". Live, remix, edit... stay different songs.
const SAME_RECORDING = '(?:(?:\\d{4}\\s+)?(?:digital(?:ly)?\\s+)?remaster(?:ed)?(?:\\s+\\d{4})?(?:\\s+version)?|(?:album|single|mono|stereo|lp)\\s+version|mono|stereo)'
const sameRecordingBracket = new RegExp(`\\s*[([]${SAME_RECORDING}[)\\]]`, 'gi')
const sameRecordingSuffix = new RegExp(`\\s+[-–—]\\s+${SAME_RECORDING}\\s*$`, 'i')
// "[Explicit]", "(Clean Version)": labels of the same recording.
const contentLabel = /\s*[([](?:explicit|clean)(?:\s+version)?[)\]]/gi
// A credit in brackets or after the name: "[feat. Joi]", "(ft. X)", " feat. Y".
const featBracket = /\s*[([](?:feat\.?|ft\.?|featuring|with)\s+[^)\]]*[)\]]/gi
const featSuffix = /\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i

/** An artist without the guests credited with them: "Estelle [feat. Joi]" -> "Estelle". */
export const mainArtist = artist => String(artist || '').replace(featBracket, '').replace(featSuffix, '').trim()

/**
 * A title to search with: without guests, "[Explicit]" and remaster labels
 * ("American Boy (feat. Kanye West)" -> "American Boy"). A remix or live
 * version keeps its label.
 */
export const searchTitle = title => String(title || '')
  .replace(contentLabel, '')
  .replace(sameRecordingBracket, '')
  .replace(sameRecordingSuffix, '')
  .replace(featBracket, stripFeatured)
  .replace(featSuffix, stripFeatured)
  .replace(/\s{2,}/g, ' ')
  .trim() || String(title || '').trim()

export const titleKey = title => recommendationKey(String(title || '')
  .replace(contentLabel, '')
  .replace(sameRecordingBracket, '')
  .replace(sameRecordingSuffix, '')
  .replace(/\s*[([](?:official (?:audio|video)|lyrics?|audio|album version|single version)[)\]]/gi, '')
  .replace(/\s*[([](?:feat\.?|ft\.?|featuring|with)\s+[^)\]]+[)\]]/gi, stripFeatured)
  .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i, stripFeatured))

const versionWords = /\b(?:remix|live|cover|instrumental|acoustic|karaoke|edit|sped up|slowed|nightcore)\b/i
const nonLatinLetters = value => [...value].some(char => /\p{L}/u.test(char) && !/\p{Script=Latin}/u.test(char))

/** Explicit bilingual aliases, e.g. "流線 - ryusen", without dropping version labels. */
export function recommendationTitles(title) {
  const original = String(title || '').normalize('NFC').trim()
  const parts = original.split(/\s+[-–—|/]\s+/).map(part => part.trim())
  if (parts.length !== 2 || versionWords.test(original) || nonLatinLetters(parts[0]) === nonLatinLetters(parts[1]) || !parts.some(part => !nonLatinLetters(part) && /\p{Script=Latin}/u.test(part))) return [original]
  return [original, ...parts.filter(part => !nonLatinLetters(part)), ...parts.filter(nonLatinLetters)]
}

export function recommendationQueries(candidate) {
  const artist = String(candidate.artist || '').normalize('NFC').trim()
  const lead = String(candidate.artists?.[0] || artist).normalize('NFC').trim()
  // Clean names first ("Estelle Grateful", not "Estelle [feat. Teedra Moses &
  // Russell Taylor] Grateful", which sources often can't find), then the
  // album's own artist, then the names as given.
  const names = [...new Set([mainArtist(artist), mainArtist(lead), mainArtist(candidate.album_artist), artist, lead].filter(Boolean))]
  const titles = [...new Set([...recommendationTitles(searchTitle(candidate.title)), ...recommendationTitles(candidate.title)])]
  const queries = []
  for (const title of titles) for (const name of names) queries.push(`${name} ${title}`.trim())
  return [...new Set(queries)].slice(0, 6)
}

export function recommendationMatch(candidate, results) {
  const titles = recommendationTitles(candidate?.title).map(titleKey)
  const artist = recommendationKey(candidate?.artist)
  if (!titles[0] || !artist) return null
  const leadArtist = recommendationKey(candidate.artists?.[0] || candidate.artist).replace(/ topic$/, '')
  // The same artists without their guests ("Estelle [feat. Joi]" is Estelle),
  // and, on an album's page, the album's artist ("Estelle, D-Nice & ...").
  const artistKeys = new Set([artist, leadArtist, recommendationKey(mainArtist(candidate.artist)), recommendationKey(mainArtist(candidate.artists?.[0])), recommendationKey(mainArtist(candidate.album_artist))].filter(Boolean))
  const sameArtist = name => artistKeys.has(recommendationKey(mainArtist(name)).replace(/ topic$/, ''))
  // Require both title and artist. A catalogue search is playback resolution,
  // not a second recommendation engine. Covers/remixes must not replace songs.
  // Of the matches, the one from the same album comes first (a compilation's
  // copy would bring another cover, and its colours, along).
  const matches = (Array.isArray(results) ? results : []).filter(result => {
    const name = String(result?.title || '')
    const prefix = name.match(/^(.+?)\s+[-–—|]\s+(.+)$/)
    const resultTitle = prefix && [artist, leadArtist].includes(recommendationKey(prefix[1])) ? prefix[2] : name
    if (!recommendationTitles(resultTitle).map(titleKey).some(title => titles.includes(title))) return false
    const artists = Array.isArray(result.artists) ? result.artists : [result.artist]
    return artists.some(sameArtist) || sameArtist(result.artist)
  })
  const album = recommendationKey(candidate.album)
  return (album && matches.find(result => recommendationKey(result.album) === album)) || matches[0] || null
}

/**
 * The cover to save a matched song with: the match's own, unless it's from
 * another release than the one picked (a compilation) -- then the picked
 * song's cover, so the colour background matches the cover shown.
 */
export function matchCover(candidate, match) {
  const picked = /^https:\/\//.test(String(candidate?.artwork_url || '')) && !/2a96cbd8b46e442fc41c2b86b821562f/.test(candidate.artwork_url) ? candidate.artwork_url : null
  const own = match?.thumbnail || match?.artwork_url || null
  if (!picked) return own
  const album = recommendationKey(candidate.album)
  return !own || (album && recommendationKey(match.album) !== album) ? picked : own
}

/** Preserve native YouTube identity across DB rows, provider fallbacks and restored queues. */
export function recommendationVideoId(track) {
  const valid = value => /^[\w-]{11}$/.test(String(value || '')) ? String(value) : null
  if (valid(track?.videoId)) return String(track.videoId)
  const ref = streamRef(track)
  if (ref?.provider === 'yt' && valid(ref.id)) return ref.id
  const saved = String(track?.source_ref || '').match(/^yt:([\w-]{11})$/)
  if (saved) return saved[1]
  if ((track?.provider === 'yt' || !track?.provider && track?.source === 'youtube' && !track?.file_path) && valid(track.id)) return String(track.id)
  for (const link of [track?.source_url, track?.url]) {
    try {
      const url = new URL(link)
      const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : /^(?:music\.|www\.)?youtube\.com$/.test(url.hostname) ? url.searchParams.get('v') : null
      if (valid(id)) return id
    } catch {}
  }
  return null
}

export async function timed(work, ms = 15000, message = 'Provider lookup timed out') {
  let timer
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })])
  } finally { clearTimeout(timer) }
}

export async function playbackSources(client = api, timeoutMs = 15000) {
  const [settings, available] = await Promise.all([
    timed(() => client.getSettings(), timeoutMs).catch(() => ({})),
    timed(() => client.onlineProviders(), timeoutMs).catch(() => DEFAULT_PLAYBACK_SOURCES),
  ])
  return orderedPlaybackSources(settings?.playback_search_order, Array.isArray(available) && available.length ? available : DEFAULT_PLAYBACK_SOURCES)
}

export const playableRecommendation = track => !!(track?.id && track.file_path && !track.preview && isPlayable(track))

export function playbackFallbackMessage({ candidate, source, nextSource, reason, detail }) {
  const label = source.label || providerLabel(source.id)
  const title = candidate.title || 'this song'
  const message = reason === 'preview' ? `${label} only has a preview of “${title}”.`
    : reason === 'not-found' ? `“${title}” wasn't found on ${label}.`
      : `“${title}” couldn't play on ${label}.`
  return `${message} ${detail ? `${detail} ` : ''}${nextSource ? `Trying ${nextSource.label || providerLabel(nextSource.id)}.` : 'No more playback sources are available.'}`
}

// Search metadata alone cannot tell whether a full stream is available (in
// particular, SoundCloud may only report its Go+ preview during resolution).
export async function playbackAvailability(match, provider, client = api, timeoutMs = 35000, onError = () => {}) {
  if (match.preview) return 'preview'
  if (typeof client.onlinePrepare !== 'function') return null
  const prepared = await timed(() => client.onlinePrepare(provider, String(match.id)), timeoutMs, 'Audio preparation timed out. Try again.')
  if (prepared?.preview) return 'preview'
  if (prepared?.error) onError(prepared.error)
  return prepared?.ok && !prepared.error ? null : 'unavailable'
}

export async function resolveRecommendationTracks(candidates, client = api, { searchLocal = true, reusePlayable = true, isCurrent = () => true, timeoutMs = 15000, prepareTimeoutMs = 35000, afterProvider, skipProviders = [], onProviderFailure, onProgress, prepareStreams = true, sources: configuredSources } = {}) {
  if (!Array.isArray(candidates) || !candidates.length || !isCurrent()) return []
  const ordered = configuredSources || await playbackSources(client, timeoutMs)
  const start = afterProvider ? ordered.findIndex(source => source.id === afterProvider) + 1 : 0
  const sources = ordered.slice(start).filter(source => source.id !== afterProvider && !skipProviders.includes(source.id))
  return (await mapLimited(uniqueSongs(candidates), async candidate => {
    if (!isCurrent()) return null
    if (reusePlayable && playableRecommendation(candidate)) return candidate
    const videoId = recommendationVideoId(candidate)
    try {
      // A song from an addon's own album or artist page: that very song, no search.
      if (candidate.exact && /^a-/.test(String(candidate.provider || '')) && candidate.id != null) {
        const saved = await timed(() => client.onlineSave([candidate]), timeoutMs).catch(() => null)
        const row = Array.isArray(saved) && playableRecommendation(saved[0]) ? saved[0] : null
        if (row && isCurrent()) return { ...row, title: candidate.title, artist: candidate.artist, album: candidate.album || row.album, artwork_url: candidate.artwork_url || row.artwork_url, source: candidate.source || 'addon' }
      }
      const local = searchLocal ? await timed(() => client.searchTracks(candidate.title), timeoutMs).catch(() => null) : null
      const rows = Array.isArray(local) ? local : Array.isArray(local?.tracks) ? local.tracks : []
      // Imported ghosts and previously cached streams must not override a newly
      // configured provider order. Only a real library file takes precedence.
      let row = rows.find(track => playableRecommendation(track) && !track.file_path.startsWith('ghost://') && songKey(track) === songKey(candidate))
      if (!row) {
        for (const [index, source] of sources.entries()) {
          if (!isCurrent()) return null
          const failed = (reason, detail) => { if (isCurrent()) onProviderFailure?.({ candidate, source, nextSource: sources[index + 1], reason, ...(detail ? { detail } : {}) }) }
          try {
            const direct = source.id === 'yt' && videoId
            if (isCurrent()) onProgress?.(`${direct ? 'Loading' : 'Searching'} ${source.label || providerLabel(source.id)} ${direct ? 'track' : 'for'} ${candidate.artist} — “${candidate.title}”…`)
            let match = direct ? { ...candidate, videoId, provider: 'yt', id: videoId } : null
            let searchError = ''
            if (!direct) {
              const deadline = Date.now() + timeoutMs
              for (const query of recommendationQueries(candidate)) {
                if (!isCurrent()) return null
                const remaining = deadline - Date.now()
                if (remaining <= 0) throw new Error('Provider lookup timed out')
                const response = await timed(() => client.onlineSearch(query, source.id), remaining)
                if (!isCurrent()) return null
                if (response?.error) { searchError = response.error; break }
                match = recommendationMatch(candidate, response?.results)
                if (match) break
              }
            }
            if (searchError) { failed('unavailable', searchError); continue }
            if (!isCurrent()) return null
            if (!match) { failed('not-found'); continue }
            let detail
            const unavailable = match.preview ? 'preview' : prepareStreams || source.id === 'sc' ? await playbackAvailability(match, source.id, client, prepareTimeoutMs, message => { detail = message }) : null
            if (!isCurrent()) return null
            if (unavailable) { failed(unavailable, detail); continue }
            const saved = await timed(() => client.onlineSave([{ ...match, provider: source.id, thumbnail: matchCover(candidate, match) || undefined }]), timeoutMs)
            // saveOnlineTracks preserves order, including nulls, for all
            // providers (addon row IDs are hashed by the backend).
            row = Array.isArray(saved) && playableRecommendation(saved[0]) ? saved[0] : null
            if (row) break
            failed('unavailable')
          } catch (error) { failed('unavailable', error?.message) }
        }
      }
      return row && isCurrent() ? {
        ...row, title: candidate.title, artist: candidate.artist,
        ...(videoId ? { videoId } : {}),
        ...(candidate.artists?.length ? { artists: candidate.artists } : {}),
        album: candidate.album || row.album,
        artwork_url: candidate.artwork_url || row.artwork_url,
        source: candidate.source || 'lastfm', reason: candidate.reason,
        scrobbledAt: candidate.scrobbledAt, scrobbleCount: candidate.scrobbleCount,
      } : null
    } catch { return null }
  })).filter(Boolean)
}

// Build until the requested count, trying additional provider pages and
// skipping failed playback matches. Previous songs are considered only after
// new recommendations; there is no shuffle of the previous eight-song shelf.
export async function buildRecommendationMix({ size, previous = [], loadPage, resolve = resolveRecommendationTracks, isCurrent = () => true }) {
  const target = [24, 32, 40].includes(Number(size)) ? Number(size) : 32
  const previousKeys = new Set(previous.map(songKey))
  const tried = new Set()
  const ids = new Set()
  const tracks = []
  const repeats = []
  async function consume(pool) {
    const candidates = uniqueSongs(pool).filter(track => !tried.has(songKey(track)))
    for (let at = 0; at < candidates.length && tracks.length < target && isCurrent(); at += 8) {
      const batch = candidates.slice(at, at + 8)
      batch.forEach(track => tried.add(songKey(track)))
      const resolved = await resolve(batch)
      if (!isCurrent()) throw new Error('Mix request superseded')
      for (const track of resolved) {
        if (!track?.id || ids.has(track.id) || tracks.length >= target) continue
        ids.add(track.id)
        tracks.push(track)
      }
    }
  }
  for (let page = 0; page < 3 && tracks.length < target && isCurrent(); page++) {
    const data = await loadPage(page)
    if (!isCurrent()) throw new Error('Mix request superseded')
    if (data?.error) throw new Error(data.error)
    const pool = uniqueSongs(data?.candidates)
    repeats.push(...pool.filter(track => previousKeys.has(songKey(track))))
    await consume(pool.filter(track => !previousKeys.has(songKey(track))).slice(0, 120))
  }
  if (tracks.length < target) await consume(repeats)
  if (!isCurrent()) throw new Error('Mix request superseded')
  if (tracks.length !== target) throw new Error(`Found ${tracks.length} playable matches for ${target} requested tracks. Try again when more recommendations are available.`)
  if (previous.length && tracks.every(track => previousKeys.has(songKey(track)))) throw new Error('The provider returned the same songs. Your existing mix has been kept; try again after more listening.')
  return tracks
}

export async function loadRecommendationPage(source, page = 0, client = api, { force = false } = {}) {
  if (source !== 'youtube') return client.lastfmDiscovery(page, force)
  const account = await client.youtubeAccount(true)
  if (account?.error) return account
  const tracks = uniqueSongs((account?.home || []).map(track => ({ ...track, source: 'youtube', artwork_url: track.thumbnail })))
  const allPlaylists = account?.homePlaylists || []
  const start = allPlaylists.length ? page * 2 % allPlaylists.length : 0
  const playlists = [...allPlaylists.slice(start), ...allPlaylists.slice(0, start)].slice(0, 2)
  const expanded = await Promise.all(playlists.map(item => client.youtubeAccountPlaylist(item.id).catch(() => null)))
  const candidates = uniqueSongs([...tracks, ...expanded.flatMap(data => data?.tracks || []).map(track => ({ ...track, source: 'youtube', artwork_url: track.thumbnail }))])
  const picks = tracks.length ? tracks : candidates
  const liked = uniqueSongs(account?.liked || []).map(track => ({ ...track, source: 'youtube', artwork_url: track.thumbnail }))
  return {
    source: 'youtube', fetchedAt: Date.now(), candidates,
    freshFinds: candidates.slice(0, 30), quickPicks: [], liked: liked.slice(0, 30), history: uniqueSongs(account?.history || []).map(track => ({ ...track, source: 'youtube', artwork_url: track.thumbnail })),
    mixes: (account?.mixes || []).map(mix => ({ ...mix, source: 'youtube', artwork_url: mix.thumbnail })),
    mixError: account?.mixError || '',
    artists: [...new Map([...(account?.artists || []), ...picks.flatMap(track => (track.artists || [track.artist]).map(name => ({ name, source: 'youtube' })))].filter(artist => artist.name).map(artist => [recommendationKey(artist.name), artist])).values()].slice(0, 30),
    albums: [...new Map([...(account?.albums || []), ...picks.filter(track => track.album).map(track => ({ title: track.album, artist: track.artist, albumId: track.albumId, artwork_url: track.thumbnail }))].map(album => [`${album.artist}\0${album.title}`, album])).values()].slice(0, 30),
    warnings: [account.homeError, account.mixError].filter(Boolean),
  }
}
