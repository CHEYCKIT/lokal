// Audio quality of a track, for display (the backend keeps the same tiers,
// electron/quality/index.js).

const OPUS_LIKE = /^(?:opus|vorbis)/i

/** Short codec name: MP3, AAC, FLAC, ALAC, Opus... */
export function codecName(codec) {
  const c = String(codec || '')
  if (!c) return ''
  if (/layer\s*3|mp3/i.test(c)) return 'MP3'
  if (/aac|mp4a/i.test(c)) return 'AAC'
  if (/opus/i.test(c)) return 'Opus'
  if (/vorbis/i.test(c)) return 'Vorbis'
  if (/alac/i.test(c)) return 'ALAC'
  if (/flac/i.test(c)) return 'FLAC'
  if (/pcm|wave?/i.test(c)) return 'WAV'
  if (/aiff/i.test(c)) return 'AIFF'
  if (/wavpack/i.test(c)) return 'WavPack'
  if (/monkey|ape/i.test(c)) return 'APE'
  return c.split(/\s+/)[0]
}

/** hires | lossless | high | low | unknown */
export function tierOf(track) {
  if (!track || track.lossless === null || track.lossless === undefined) return 'unknown'
  if (Number(track.lossless) === 1) return Number(track.bit_depth) > 16 || Number(track.sample_rate) > 48000 ? 'hires' : 'lossless'
  const kbps = Number(track.bitrate) || 0
  return kbps && kbps >= (OPUS_LIKE.test(String(track.codec || '')) ? 160 : 256) ? 'high' : 'low'
}

/** Did the spectrum check say this lossless file came from a lossy one? */
export function isSuspect(track) {
  return Number(track?.lossless) === 1 && (track?.spectral_verdict === 'lossy' || track?.spectral_verdict === 'likely-lossy')
}

/** Worth getting again in lossless: lossy, or a suspect lossless file. */
export function isUpgradable(track) {
  return Number(track?.lossless) === 0 || isSuspect(track)
}

export const TIERS = {
  hires: { label: 'Hi-res', desc: 'Above CD quality', hint: 'Lossless, more than 16-bit or 48 kHz', className: 'bg-violet-500/15 text-violet-300 border-violet-400/25' },
  lossless: { label: 'Lossless', desc: 'CD quality', hint: 'Lossless, 16-bit up to 48 kHz', className: 'bg-green-500/15 text-green-300 border-green-400/25' },
  high: { label: 'High', desc: 'Lossy, 256 kbps and up', hint: 'MP3/AAC at 256 kbps or more, Opus/Vorbis at 160 kbps or more', className: 'bg-sky-500/15 text-sky-300 border-sky-400/25' },
  low: { label: 'Low', desc: 'Lossy, under 256 kbps', hint: 'MP3/AAC under 256 kbps, Opus/Vorbis under 160 kbps', className: 'bg-yellow-500/15 text-yellow-200 border-yellow-400/25' },
  suspect: { label: 'Suspect', desc: 'FLAC made from a lossy file', hint: 'The spectrum check found a lossy encoder\'s cut-off', className: 'bg-red/15 text-red border-red/30' },
  unknown: { label: 'Not read', desc: 'Details not read yet', className: 'bg-white/5 text-muted border-border' },
}

/** "FLAC · 24-bit / 96 kHz", "MP3 · 128 kbps"... */
export function formatLabel(track) {
  const name = codecName(track?.codec)
  if (!name) return track?.bitrate ? `${track.bitrate} kbps` : ''
  if (Number(track.lossless) === 1) {
    const bits = Number(track.bit_depth) ? `${track.bit_depth}-bit` : ''
    const rate = Number(track.sample_rate) ? `${+(track.sample_rate / 1000).toFixed(1)} kHz` : ''
    const detail = [bits, rate].filter(Boolean).join(' / ')
    return detail ? `${name} · ${detail}` : name
  }
  return track.bitrate ? `${name} · ${track.bitrate} kbps` : name
}

/** What the spectrum check found, in words (null if not checked). */
export function verdictText(track) {
  const cutoff = Number(track?.spectral_cutoff) ? `${track.spectral_cutoff / 1000} kHz` : ''
  switch (track?.spectral_verdict) {
    case 'ok': return 'Spectrum checked: full range, no sign of a lossy source.'
    case 'lossy': return `Spectrum checked: nothing above ${cutoff}. Made from an MP3/AAC at 192 kbps or less.`
    case 'likely-lossy': return `Spectrum checked: nothing above ${cutoff}, like a 256-320 kbps MP3. Some real masters stop there too.`
    case 'inconclusive': return 'Spectrum checked: not enough high frequencies in this recording to tell.'
    default: return null
  }
}

// Qobuz stores, by country, with the languages each one comes in (the
// first is its default). Its search only works under one of these.
const QOBUZ_STORES = {
  us: ['en'], ca: ['en', 'fr'], gb: ['en'], ie: ['en'], au: ['en'], nz: ['en'],
  fr: ['fr'], be: ['fr', 'nl'], lu: ['fr'], ch: ['fr', 'de'],
  de: ['de'], at: ['de'], it: ['it'], es: ['es'], nl: ['nl'],
  se: ['en'], dk: ['en'], no: ['en'], fi: ['en'], jp: ['ja'],
}
// Language only (no country, or a country without a Qobuz store).
const QOBUZ_BY_LANGUAGE = { en: 'us-en', fr: 'fr-fr', de: 'de-de', it: 'it-it', es: 'es-es', nl: 'nl-nl', ja: 'jp-ja' }

/**
 * The Qobuz store for the app's language and region (the system's, e.g.
 * fr-FR → "fr-fr", en-GB → "gb-en", de-CH → "ch-de"); US English otherwise.
 */
export function qobuzLocale(languages = (typeof navigator !== 'undefined' && (navigator.languages?.length ? navigator.languages : [navigator.language])) || []) {
  for (const tag of languages) {
    const [lang = '', region = ''] = String(tag || '').toLowerCase().split(/[-_]/)
    const store = QOBUZ_STORES[region]
    if (store) return `${region}-${store.includes(lang) ? lang : store[0]}`
    if (QOBUZ_BY_LANGUAGE[lang]) return QOBUZ_BY_LANGUAGE[lang]
  }
  return 'us-en'
}

/** Store searches for a track (Qobuz in the app's region). */
export function storeSearches({ artist, title }) {
  const q = [String(artist || '').split(/\s*,\s*/)[0], title].filter(Boolean).join(' ').replace(/\s*\((?:feat|ft)\.?[^)]*\)/ig, '').trim()
  const e = encodeURIComponent(q)
  return [
    // Qobuz only answers searches under a locale, as a path (/search?q= doesn't work).
    { store: 'Qobuz', kind: 'search', format: 'FLAC, up to 24-bit', url: `https://www.qobuz.com/${qobuzLocale()}/search/albums/${e}` },
    { store: 'Bandcamp', kind: 'search', format: 'FLAC, when the artist sells there', url: `https://bandcamp.com/search?q=${e}&item_type=t` },
    { store: '7digital', kind: 'search', format: 'FLAC for many releases', url: `https://us.7digital.com/search?q=${e}` },
  ]
}

/** Open "Get it in lossless" for a track (the dialog lives in App). */
export function openLossless(track) {
  window.dispatchEvent(new CustomEvent('lokal:lossless', { detail: track }))
}
