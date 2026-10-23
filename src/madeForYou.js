// Home → Local → "Made for you": up to 24 songs, four from each of Your Mixes,
// picked once when Lokal starts and kept until the next start (refreshing
// the mixes doesn't reshuffle them).

export const PER_MIX = 4
export const MIXES = 6

const picked = new Map() // user -> [{ track, mix }]

export function shuffled(list, random = Math.random) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Four songs from each of the first six mixes, no song twice (a mix whose
 * songs are already picked gives others), in mix order: [{ track, mix }].
 */
export function pickMadeForYou(mixes, { random = Math.random, perMix = PER_MIX, count = MIXES } = {}) {
  const seen = new Set()
  const picks = []
  for (const mix of (Array.isArray(mixes) ? mixes : []).slice(0, count)) {
    let taken = 0
    for (const track of shuffled(mix?.tracks || [], random)) {
      if (taken >= perMix) break
      if (!track?.id || seen.has(track.id)) continue
      seen.add(track.id)
      picks.push({ track, mix: { id: mix.id, name: mix.name } })
      taken++
    }
  }
  return picks
}

/** This session's picks for `user`, made the first time the mixes are there. */
export function madeForYou(user, mixes, options) {
  const key = String(user || 'guest')
  // The mixes are sampled afresh each time Home loads: the picks stay as they
  // were (the same list, so a card's position never moves under the pointer).
  const known = picked.get(key)
  if (known?.length) return known
  const picks = pickMadeForYou(mixes, options)
  if (picks.length) picked.set(key, picks)
  return picks
}

export function forgetMadeForYou() { picked.clear() }
