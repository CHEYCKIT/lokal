// Whether a song found online for a Flow mood belongs there: its AutoMix
// analysis (electron/automix/analysis.js: tempo, loudness) against the
// library song it was found from (its seed, a song that fits the mood).
// Online songs have none of the audio features moods are picked on, so this
// is a check, not a choice: it turns away what clearly doesn't belong (a
// 170 BPM banger found from a chill song), not what's merely different.
//
// Analysis' "energy" is loudness (−30…−8 dB as 0…1), and most songs are
// mastered loud, so it's compared with the seed's, not held to a level.

const TEMPO_SLACK = 0.16 // ±16% (after halving or doubling): the same pace, to the ear
const LOUDNESS_SLACK_DB = 7
const MIN_BEAT_CONFIDENCE = 0.35

// The pace each mood keeps, in BPM (a half-time or double-time reading folded in).
const MOOD_TEMPO = {
  chill: [55, 128],
  focus: [50, 132],
  love: [55, 132],
  melancholy: [50, 128],
  workout: [100, 190],
  party: [95, 180],
}

/** The tempo folded toward `around` (×2, ×½): a half-time reading of the same pace counts as the same. */
function fold(bpm, around) {
  let value = bpm
  while (value > around * 1.42) value /= 2
  while (value < around / 1.42) value *= 2
  return value
}

const steady = analysis => Number(analysis?.bpm) > 0 && Number(analysis?.beatConfidence ?? 1) >= MIN_BEAT_CONFIDENCE

/**
 * @param mood the Flow's mood; `candidate` and `seed` their analyses (or null)
 * @returns { fit, reason } — fit when nothing rules it out
 */
export function fitsMood({ mood, candidate, seed }) {
  if (!candidate) return { fit: true, reason: 'not analysed' } // nothing to go on: the seed's similarity alone
  const range = MOOD_TEMPO[mood]
  if (steady(candidate)) {
    if (steady(seed)) {
      const pace = fold(Number(candidate.bpm), Number(seed.bpm)) / Number(seed.bpm)
      if (Math.abs(pace - 1) > TEMPO_SLACK) return { fit: false, reason: `tempo ${Math.round(candidate.bpm)} against ${Math.round(seed.bpm)}` }
    }
    if (range) {
      const [low, high] = range
      // Either reading of its pace inside the mood's range will do.
      const readings = [Number(candidate.bpm), Number(candidate.bpm) / 2, Number(candidate.bpm) * 2]
      if (!readings.some(bpm => bpm >= low && bpm <= high)) return { fit: false, reason: `tempo ${Math.round(candidate.bpm)} outside ${low}–${high}` }
    }
  }
  if (Number.isFinite(Number(candidate.loudness)) && Number.isFinite(Number(seed?.loudness))) {
    const apart = Number(candidate.loudness) - Number(seed.loudness)
    // Much louder than a quiet mood's seed (or much quieter than a lively one's).
    const quietMood = ['chill', 'focus', 'love', 'melancholy'].includes(mood)
    if (quietMood ? apart > LOUDNESS_SLACK_DB : apart < -LOUDNESS_SLACK_DB) return { fit: false, reason: `${apart > 0 ? 'louder' : 'quieter'} by ${Math.abs(apart).toFixed(1)} dB` }
  }
  return { fit: true, reason: 'fits' }
}
