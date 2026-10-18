// Lokal addon for Yandex Music, as a Cloudflare Worker.
// Install URL: https://<your-worker>/<YANDEX_OAUTH_TOKEN>/manifest.json
// The token lives only in the URL you paste into Lokal; nothing is stored here.
const API = 'https://api.music.yandex.net'
const SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA'

const MANIFEST = {
  id: 'yandex-music',
  name: 'Yandex Music',
  version: '1.0.0',
  description: 'Search and stream from Yandex Music (needs a Yandex account token in the URL).',
  resources: ['search', 'stream'],
  types: ['track'],
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } })

async function md5(text) {
  const buf = await crypto.subtle.digest('MD5', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const yandex = (token, path) =>
  fetch(API + path, { headers: { Authorization: `OAuth ${token}`, 'X-Yandex-Music-Client': 'YandexMusicAndroid/24023231' } })
    .then(r => { if (!r.ok) throw new Error(`Yandex ${r.status}`); return r.json() })

const cover = uri => (uri ? `https://${uri.replace('%%', '400x400')}` : '')

export function mapTrack(t) {
  const artists = (t.artists || []).map(a => ({ id: String(a.id), name: a.name }))
  const album = (t.albums || [])[0] || {}
  return {
    id: album.id ? `${t.id}:${album.id}` : String(t.id),
    title: t.title + (t.version ? ` (${t.version})` : ''),
    artist: artists.map(a => a.name).join(', '),
    artists,
    album: album.title || '',
    albumId: album.id ? String(album.id) : undefined,
    trackNumber: album.trackPosition?.index,
    discNumber: album.trackPosition?.volume,
    year: album.year,
    duration: t.durationMs ? Math.round(t.durationMs / 1000) : undefined,
    artworkURL: cover(t.coverUri || album.coverUri),
    format: 'mp3',
  }
}

export async function signedUrl(xml) {
  const pick = tag => (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1]
  const host = pick('host'), path = pick('path'), ts = pick('ts'), s = pick('s')
  if (!host || !path || !ts || !s) throw new Error('Unexpected download-info response')
  return `https://${host}/get-mp3/${await md5(SIGN_SALT + path.slice(1) + s)}/${ts}${path}`
}

async function stream(token, id) {
  const trackId = id.split(':')[0]
  const { result } = await yandex(token, `/tracks/${trackId}/download-info`)
  const best = [...result].filter(r => r.codec === 'mp3').sort((a, b) => b.bitrateInKbps - a.bitrateInKbps)[0]
  if (!best) throw new Error('No downloadable format')
  const xml = await fetch(best.downloadInfoUrl, { headers: { Authorization: `OAuth ${token}` } }).then(r => r.text())
  return { url: await signedUrl(xml), format: 'mp3', expiresAt: Date.now() + 60_000 }
}

export default {
  async fetch(req) {
    const [, token, route, arg] = new URL(req.url).pathname.split('/')
    if (!token) return json({ error: 'Put your Yandex token in the URL' }, 400)
    try {
      if (route === 'manifest.json') return json(MANIFEST)
      if (route === 'search') {
        const q = new URL(req.url).searchParams.get('q') || ''
        const { result } = await yandex(token, `/search?type=track&page=0&text=${encodeURIComponent(q)}`)
        return json({ tracks: (result?.tracks?.results || []).map(mapTrack) })
      }
      if (route === 'stream' && arg) return json(await stream(token, decodeURIComponent(arg)))
      return json({ error: 'Not found' }, 404)
    } catch (e) {
      return json({ error: String(e.message || e) }, 502)
    }
  },
}
