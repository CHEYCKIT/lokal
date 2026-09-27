// Cleaning track names into what lyrics catalogues index them under.


const NOISE_PATTERNS = [
  /\s*[(\[](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi,
  /\s*[(\[][^)\]]*(?:official|video|audio|lyrics?|visuali[sz]er|music video|mv|hd|hq|4k)[^)\]]*[)\]]/gi,
  /\s*[(\[][^)\]]*(?:remaster(?:ed)?|re-?recorded|explicit|clean|radio edit|single version|album version|mono|stereo)[^)\]]*[)\]]/gi,
  /\s+-\s+(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?$/i,
  /\s+-\s+(?:single|radio edit|album version|explicit|clean)$/i,
  /\s+(?:feat\.?|ft\.?)\s.*$/i,
]

function forLyricsSearch(title) {
  let t = String(title || '')
  for (const re of NOISE_PATTERNS) t = t.replace(re, '')
  return t.replace(/\s{2,}/g, ' ').trim() || String(title || '').trim()
}

function artistForSearch(artist, keepCommaArtists = []) {
  const a = String(artist || '').trim()
  if (!a) return a
  if (keepCommaArtists.some(k => k && k.toLowerCase() === a.toLowerCase())) return a
  return a.split(/\s*(?:,|;|&|\s+x\s+|\/|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i)[0].trim() || a
}

module.exports = { forLyricsSearch, artistForSearch }
