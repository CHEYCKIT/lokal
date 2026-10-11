// "Get it in lossless": finding a higher-quality copy of a library song on
// your addon sources, for one song (LosslessModal) or several at once
// (BulkLosslessModal).

import { canGetLossless } from './quality.js'
import { differentDuration } from './ghostDownloads.js'

const LOSSLESS_HINT = /lossless|flac|hi-?res|24[ -]?bit|alac|wav|cd quality|16[ -]?bit/i
// A result an addon labels lossy is no upgrade, however well it matches.
const LOSSY_HINT = /\b(mp3|aac|ogg|opus|vorbis|m4a|\d{2,3}\s?k(?:bps)?|low|normal|high quality)\b/i
const plainText = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Closest to the song first: same title and artist, near its length, marked lossless. */
export function rankReplacements(track, items) {
  const title = plainText(track.title), artist = plainText(String(track.artist || '').split(/\s*,\s*/)[0])
  const score = item => (plainText(item.title) === title ? 4 : plainText(item.title).includes(title) ? 2 : 0)
    + (plainText(item.artist).includes(artist) ? 3 : 0)
    + (!differentDuration(track, item) ? 2 : 0)
    + (LOSSLESS_HINT.test(String(item.quality || '')) ? 1 : 0)
  const lossy = item => { const quality = String(item.quality || ''); return !!quality && LOSSY_HINT.test(quality) && !LOSSLESS_HINT.test(quality) }
  return items.filter(item => !item.preview && !lossy(item) && score(item) >= 5).sort((a, b) => score(b) - score(a))
}

/** The addon sources that can be searched now, and those that need setting up first. */
export async function replacementSources(client) {
  const providers = await Promise.resolve(client.onlineProviders?.()).catch(() => null)
  const addons = (Array.isArray(providers) ? providers : []).filter(provider => provider.addon)
  return { usable: addons.filter(provider => !provider.needsSetup), setup: addons.filter(provider => provider.needsSetup) }
}

/** Each source's best matches for the song: [{ source, items, error? }]. */
export function searchReplacements(track, sources, client, { limit = 3 } = {}) {
  const query = [String(track.artist || '').split(/\s*,\s*/)[0], track.title].filter(Boolean).join(' ')
  return Promise.all(sources.map(async source => {
    try {
      const response = await client.onlineSearch(query, source.id)
      if (response?.error) throw new Error(response.error)
      const rows = Array.isArray(response) ? response : response?.results || []
      return { source, items: rankReplacements(track, rows.map(item => ({ ...item, provider: item.provider || source.id }))).slice(0, limit) }
    } catch (error) { return { source, items: [], error: error.message } }
  }))
}

/** The songs that can be upgraded, and how many of the others were left out. */
export function losslessCandidates(tracks) {
  const seen = new Set()
  const eligible = []
  let skipped = 0
  for (const track of tracks || []) {
    if (!track || seen.has(String(track.id))) continue
    seen.add(String(track.id))
    if (canGetLossless(track)) eligible.push(track)
    else skipped++
  }
  return { eligible, skipped }
}

/**
 * The one replacement to suggest from every source's ranked matches: the
 * same length first, then marked lossless, then rank, then the sources'
 * order. Ticked from the start only when its length is known to match.
 */
export function bestReplacement(track, groups) {
  const options = []
  ;(groups || []).forEach((group, sourceIndex) => {
    ;(group.items || []).forEach((item, rank) => options.push({ item, source: group.source, sourceIndex, rank }))
  })
  if (!options.length) return null
  // 2: both lengths known and close; 1: one isn't known; 0: they differ.
  const known = value => Number.isFinite(Number(value)) && Number(value) > 0
  const length = option => !known(track?.duration) || !known(option.item.duration) ? 1 : differentDuration(track, option.item) ? 0 : 2
  const lossless = option => LOSSLESS_HINT.test(String(option.item.quality || ''))
  options.sort((a, b) => (length(b) - length(a)) || (lossless(b) - lossless(a)) || (a.rank - b.rank) || (a.sourceIndex - b.sourceIndex))
  const best = options[0]
  // Ticked only when its length is known to match: an unknown one is checked by you.
  return { item: best.item, source: best.source, lengthDiffers: length(best) === 0, lengthUnknown: length(best) === 1, checked: length(best) === 2 }
}
