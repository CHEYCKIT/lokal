// Apple Music: the artists in your library (Home → Releases → Followed
// artists → Apple Music). Apple has no public API for this without a paid
// developer account, so -- like Spotify's sp_dc -- it uses your own
// media-user-token cookie from music.apple.com, with the developer token
// the Apple Music web app itself uses (read out of its script). Both only
// ever go to apple.com.

const ORIGIN = 'https://music.apple.com'
const API = 'https://amp-api.music.apple.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

let developer = null // { token, exp }

function jwtPayload(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')) } catch { return null }
}

/** The web app's developer token among the tokens in its script ("AMPWebPlay"). */
function pickDeveloperToken(script) {
  const tokens = String(script || '').match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []
  const now = Date.now() / 1000
  return tokens.find(token => { const payload = jwtPayload(token); return payload?.iss === 'AMPWebPlay' && (!payload.exp || payload.exp > now) }) || null
}

async function getText(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Apple Music answered HTTP ${res.status}.`)
  return res.text()
}

async function developerToken({ fetchImpl = fetch } = {}) {
  if (developer && developer.exp * 1000 - 60000 > Date.now()) return developer.token
  const page = await getText(`${ORIGIN}/us/browse`, fetchImpl)
  const scripts = [...new Set(page.match(/\/assets\/index[^"']*\.js/g) || [])]
  for (const script of scripts) {
    const token = pickDeveloperToken(await getText(`${ORIGIN}${script}`, fetchImpl))
    if (token) { developer = { token, exp: jwtPayload(token)?.exp || Date.now() / 1000 + 3600 }; return token }
  }
  throw new Error("Couldn't read Apple Music's web player token. Try again later.")
}

/** Accept the bare value or a pasted "media-user-token=...;" fragment. */
function userTokenValue(raw) {
  const s = String(raw || '').trim()
  const m = s.match(/(?:^|;\s*)media-user-token=([^;]+)/)
  return (m ? m[1] : s).trim()
}

/** The names of the artists in the account's Apple Music library. */
async function libraryArtists(rawUserToken, { fetchImpl = fetch, limit = 5000 } = {}) {
  const userToken = userTokenValue(rawUserToken)
  if (!userToken) throw new Error('Add your Apple Music media-user-token first.')
  const token = await developerToken({ fetchImpl })
  const names = []
  let path = '/v1/me/library/artists?limit=100'
  while (path && names.length < limit) {
    const res = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, 'media-user-token': userToken, Origin: ORIGIN, 'User-Agent': UA, Accept: 'application/json' } })
    if (res.status === 401 || res.status === 403) throw new Error('Apple Music did not accept the media-user-token. Copy a fresh one from music.apple.com.')
    if (!res.ok) throw new Error(`Apple Music answered HTTP ${res.status}.`)
    const body = await res.json()
    for (const artist of body?.data || []) if (artist?.attributes?.name) names.push(artist.attributes.name)
    path = body?.next || null
  }
  return names
}

module.exports = { libraryArtists, developerToken, pickDeveloperToken, userTokenValue }
