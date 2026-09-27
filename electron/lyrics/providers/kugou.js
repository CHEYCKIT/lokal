// KuGou: whole-line LRC, strong on Chinese, Japanese and Korean releases the
// English-first catalogues miss. Three hops: song search -> lyric candidates
// by the song's hash -> the LRC itself (base64).
//
// Its files open with credit lines ("作词：…", "Artist - Title") stamped at the
// top; those are dropped so they don't read as the first sung lines.

const { getJson, withQuery } = require('../http')

const DURATION_TOLERANCE = 8
const CREDIT = /^[^\s\[]{0,12}\s*[：:]/
const CREDIT_WORDS = /^(作词|作曲|编曲|制作|监制|混音|录音|词|曲|演唱|歌手|原唱|出品|发行|Lyrics|Composer|Arranger|Producer)\b/i

function cleanTitle(t) { return String(t || '').replace(/[(（].*?[)）]/g, '').trim() || t }

async function fetch(query, ctx = {}) {
  const title = cleanTitle(query.searchTitle || query.title)
  const artist = query.searchArtist || query.artist
  const duration = query.duration ? Math.round(query.duration) : 0

  const search = await getJson(withQuery('https://mobileservice.kugou.com/api/v3/search/song', {
    version: 9108, plat: 0, pagesize: 8, showtype: 0, keyword: `${artist} ${title}`,
  }), { signal: ctx.signal })
  const songs = search?.data?.info || []
  const song = songs.find(s => !duration || Math.abs((s.duration || 0) - duration) <= DURATION_TOLERANCE)
  const byHash = song?.hash
    ? await getJson(withQuery('https://lyrics.kugou.com/search', { ver: 1, man: 'yes', client: 'pc', hash: song.hash }), { signal: ctx.signal })
    : null
  let candidates = byHash?.candidates || []
  if (!candidates.length) {
    const byName = await getJson(withQuery('https://lyrics.kugou.com/search', {
      ver: 1, man: 'yes', client: 'pc', keyword: `${artist} - ${title}`, duration: duration ? duration * 1000 : undefined,
    }), { signal: ctx.signal })
    candidates = byName?.candidates || []
  }
  const candidate = candidates.find(c => !duration || !c.duration || Math.abs(c.duration / 1000 - duration) <= DURATION_TOLERANCE)
  if (!candidate) return null

  const download = await getJson(withQuery('https://lyrics.kugou.com/download', {
    fmt: 'lrc', charset: 'utf8', client: 'pc', ver: 1, id: candidate.id, accesskey: candidate.accesskey,
  }), { signal: ctx.signal })
  if (!download?.content) return null
  const lrc = Buffer.from(download.content, 'base64').toString('utf8')

  // Drop the credit block at the head of the file.
  const cleaned = lrc.split('\n').filter((line, index) => {
    const body = line.replace(/^(\[[^\]]*\])+/, '').trim()
    if (!body) return true
    if (CREDIT_WORDS.test(body) || (index < 20 && CREDIT.test(body) && body.length < 40)) return false
    if (index < 20 && /\s-\s/.test(body) && body.toLowerCase().includes(String(title).toLowerCase())) return false
    return true
  }).join('\n')
  return { raw: cleaned }
}

module.exports = { fetch }
