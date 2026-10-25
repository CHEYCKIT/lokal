/**
 * Port of Lokal Mobile's PlayerArtworkQuality rules for CDN-specific covers.
 * The returned order always ends with the provider's original, known-valid
 * thumbnail so missing full-size variants can never erase album art.
 * Do not strip signed query strings or invent URLs on unknown hosts.
 */
export function artworkCandidates(raw) {
  if (!raw || typeof raw !== 'string') return []
  let uri
  try { uri = new URL(raw) } catch { return [raw] }
  if (!['https:', 'http:'].includes(uri.protocol)) return [raw]
  const host = uri.hostname.toLowerCase()
  const path = uri.pathname
  let upgraded = null
  const replacePath = next => { if (next !== path) upgraded = new URL(raw).href.replace(path, next) }

  if (host === 'i.scdn.co' && path.startsWith('/image/')) {
    replacePath(path.replace(/ab67616d(?:00004851|000082c1|00001e02)/, 'ab67616d0000b273'))
  } else if (/^(?:is[1-5]-ssl|a1)\.mzstatic\.com$/.test(host)) {
    replacePath(path.replace(/\/(\d{2,4})x(\d{2,4})bb\./, (original, w, h) =>
      +w < 1200 && +h < 1200 ? '/1200x1200bb.' : original))
  } else if (host.endsWith('.dzcdn.net') && path.startsWith('/images/cover/')) {
    replacePath(path.replace(/\/(\d{2,4})x(\d{2,4})-/, (original, w, h) =>
      +w < 1000 && +h < 1000 ? '/1000x1000-' : original))
  } else if (host === 'resources.tidal.com' && path.startsWith('/images/')) {
    replacePath(path.replace(/\/(\d{2,4})x(\d{2,4})\.jpg$/i, (original, w, h) =>
      +w < 1280 && +h < 1280 ? '/1280x1280.jpg' : original))
  } else if (['m.media-amazon.com', 'images-na.ssl-images-amazon.com',
    'images-eu.ssl-images-amazon.com', 'images-fe.ssl-images-amazon.com',
    'images.amazon.com', 'ecx.images-amazon.com'].includes(host)) {
    // Amazon's resize/crop suffix points to a smaller rendition of the
    // identical catalogued image; ask for the master with the same object ID.
    replacePath(path.replace(/\._[^/.]+_\.(?=(?:jpg|jpeg|png|webp)$)/i, '.'))
  }

  if (!upgraded && /(^|\.)googleusercontent\.com$|(^|\.)ggpht\.com$/.test(host)) {
    if (/=w\d+-h\d+/.test(raw)) {
      upgraded = raw.replace(/=w(\d+)-h(\d+)/, (original, w, h) =>
        +w < 1200 || +h < 1200 ? '=w1200-h1200' : original)
    } else if (/=s\d+(?=-|$)/.test(raw)) {
      upgraded = raw.replace(/=s(\d+)(?=-|$)/, (original, n) =>
        +n < 1200 ? '=s1200' : original)
    }
  }
  if (!upgraded && ['i.ytimg.com', 'img.youtube.com'].includes(host)) {
    const match = path.match(/\/(?:default|mqdefault|hqdefault|sddefault|hq720)\.jpg$/i)
    if (match) {
      const upgraded = size => {
        const url = new URL(raw)
        url.pathname = url.pathname.replace(match[0], '/' + size + '.jpg')
        return url.href
      }
      return [...new Set([upgraded('maxresdefault'), upgraded('sddefault'), raw])]
    }
  }
  return [...new Set([upgraded, raw].filter(Boolean))]
}
