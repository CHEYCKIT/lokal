// SpicyLyrics' supported developer API. It needs a user-provided secret key and
// a Spotify track id; the existing Spotify cookie is used only to match a local
// title/artist to that id when the public catalogue match is unavailable.
const { getJson, withQuery } = require('../http')
const { findSpotifyTrackId } = require('../../artwork/spotify')
const { unit, joinUnits, spacing, round3 } = require('../model')

const BASE = 'https://api.spicylyrics.org/v1/lyrics/'

function timedUnits(items = []) {
  const out = []
  for (const item of items) {
    if (item?.Text == null || item.StartTime == null) continue
    const { core, lead, trail } = spacing(String(item.Text))
    if (lead && out.length) out[out.length - 1].space = true
    if (!core) continue
    out.push(unit(core, Number(item.StartTime), Number(item.EndTime ?? item.StartTime), trail || !item.IsPartOfWord))
  }
  if (out.length) out[out.length - 1].space = false
  return out
}

function parse(body) {
  const lyrics = body?.Body
  if (!lyrics) return null
  if (lyrics.Type === 'Syllable') {
    const lines = []
    for (const line of lyrics.Content || []) {
      const lead = timedUnits(line?.Lead?.Syllables)
      const background = timedUnits((line?.Background || []).flatMap(group => group?.Syllables || []))
      const start = Number(line?.Lead?.StartTime ?? lead[0]?.time)
      const end = Number(line?.Lead?.EndTime ?? lead.at(-1)?.end)
      const text = lead.length ? joinUnits(lead) : ''
      if (!text && !background.length) continue
      const parsed = {
        time: Number.isFinite(start) ? round3(start) : null,
        end: Number.isFinite(end) ? round3(end) : null,
        endStated: Number.isFinite(end),
        text,
        words: lead,
      }
      if (background.length) { parsed.bgWords = background; parsed.bgText = joinUnits(background) }
      parsed.agent = line?.OppositeAligned ? 'v2' : 'v1'
      if (line.Lead?.TransliteratedText) parsed.romanization = { text: line.Lead.TransliteratedText }
      lines.push(parsed)
    }
    return { lines, attribution: attribution(lyrics) }
  }
  if (lyrics.Type === 'Line') {
    return { lines: (lyrics.Content || []).map(line => ({
      time: line?.StartTime == null ? null : Number(line.StartTime),
      end: line?.EndTime == null ? null : Number(line.EndTime),
      endStated: line?.EndTime != null,
      text: String(line?.Text || ''),
      words: [],
      agent: line?.OppositeAligned ? 'v2' : 'v1',
      ...(line?.TransliteratedText ? { romanization: { text: line.TransliteratedText } } : {}),
    })).filter(line => line.text), attribution: attribution(lyrics) }
  }
  if (lyrics.Type === 'Static') {
    return { lines: (lyrics.Content || lyrics.Lines || []).map(line => ({ time: null, end: null, text: String(line?.Text ?? (typeof line === 'string' ? line : '')), words: [] })).filter(line => line.text), attribution: attribution(lyrics) }
  }
  return null
}

function attribution(lyrics) {
  const contributor = value => value?.username && /^https:\/\/spicylyrics\.org\/uid\/\d+$/.test(value.url || '')
    ? { name: String(value.username), url: value.url } : null
  return {
    provider: ({ spicy_lyrics: 'Spicy Lyrics', apple_music: 'Apple Music', spotify: 'Spotify' })[lyrics.source] || 'Spicy Lyrics',
    uploader: contributor(lyrics.UploadAttribution?.Uploader),
    maker: contributor(lyrics.UploadAttribution?.Maker),
  }
}

const norm = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const ids = new Map()
/** Public recording links avoid requiring a Spotify account just for lyrics. */
async function recordingId(query, ctx) {
  if (/^[A-Za-z0-9]{22}$/.test(query.spotifyId || '')) return query.spotifyId
  const key = query.isrc || `${query.searchArtist || query.artist}|${query.searchTitle || query.title}|${query.duration || 0}`
  if (ids.has(key)) return ids.get(key)
  let recording = query.isrc ? await getJson(`https://api.deezer.com/track/isrc:${encodeURIComponent(query.isrc)}`, { signal: ctx.signal, timeoutMs: 3500 }) : null
  if (!recording?.id) {
    const results = await getJson(withQuery('https://api.deezer.com/search', { q: `artist:"${query.searchArtist || query.artist}" track:"${query.searchTitle || query.title}"`, limit: 10 }), { signal: ctx.signal, timeoutMs: 3500 })
    recording = results?.data?.find(item => norm(item.title) === norm(query.searchTitle || query.title)
      && norm(item.artist?.name) === norm(query.searchArtist || query.artist)
      && (!query.duration || Math.abs(item.duration - query.duration) <= 5))
  }
  if (ctx.signal?.aborted) return null
  let id = null
  if (recording?.id) {
    const links = await getJson(withQuery('https://api.song.link/v1-alpha.1/links', { url: `https://www.deezer.com/track/${recording.id}` }), { signal: ctx.signal, timeoutMs: 3500 })
    id = links?.linksByPlatform?.spotify?.url?.match(/\/track\/([A-Za-z0-9]{22})(?:[/?#]|$)/)?.[1]
  }
  if (!id && query.spotifyCookie && !ctx.signal?.aborted) id = await findSpotifyTrackId(query, query.spotifyCookie).catch(() => null)
  if (id) { if (ids.size >= 500) ids.delete(ids.keys().next().value); ids.set(key, id) }
  return id
}

async function fetch(query, ctx = {}) {
  if (!query.spicyKey || ctx.signal?.aborted) return null
  const id = await recordingId(query, ctx)
  if (!id || ctx.signal?.aborted) return null
  return parse(await getJson(`${BASE}${encodeURIComponent(id)}`, {
    signal: ctx.signal,
    timeoutMs: 9000,
    headers: { Authorization: `Bearer ${query.spicyKey}` },
  }))
}

module.exports = { fetch, parse }
