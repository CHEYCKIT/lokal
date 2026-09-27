// LyricsPlus (the open backend behind the YouLy+ extension): syllable-timed,
// aggregating Apple Music, QQ Music and Musixmatch.
//
// It runs on volunteer mirrors, most of which are down, rate-limited or out of
// credit at any given moment. So every mirror is asked at once and the first
// *usable* answer wins (a mirror that 404s this track shouldn't beat one that
// has it). The winner is remembered so the next track tries it first.

const { getJson, withQuery } = require('../http')
const { unit, joinUnits, spacing, round3 } = require('../model')

const MIRRORS = [
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.atomix.one',
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyricsplus-seven.vercel.app',
  'https://lyrics-plus-backend.vercel.app',
]

let lastGood = null

function toUnits(syllables) {
  const out = []
  for (const s of syllables) {
    if (s?.text == null || s.time == null) continue
    const { core, lead, trail } = spacing(String(s.text))
    if (lead && out.length) out[out.length - 1].space = true
    if (!core) { if (trail && out.length) out[out.length - 1].space = true; continue }
    out.push(unit(core, s.time / 1000, (s.time + (s.duration || 0)) / 1000, trail))
  }
  if (out.length) out[out.length - 1].space = false
  return out
}

function parse(response) {
  const agents = {}
  for (const [id, agent] of Object.entries(response?.metadata?.agents || {})) {
    if (agent?.type) agents[agent.alias || id] = agent.type
  }
  const lines = []
  for (const line of response?.lyrics || []) {
    if (line?.time == null) continue
    const syllables = Array.isArray(line.syllabus) ? line.syllabus : []
    const leadUnits = toUnits(syllables.filter(s => !s.isBackground))
    const bgUnits = toUnits(syllables.filter(s => s.isBackground))
    const start = line.time / 1000
    const built = {
      time: round3(leadUnits.length ? Math.min(start, leadUnits[0].time) : start),
      end: line.duration ? round3(start + line.duration / 1000) : null,
      endStated: !!line.duration || leadUnits.length > 0,
      text: leadUnits.length ? joinUnits(leadUnits) : String(line.text || '').trim(),
      words: leadUnits,
    }
    if (bgUnits.length) { built.bgWords = bgUnits; built.bgText = joinUnits(bgUnits) }
    const element = line.element
    const singer = element && typeof element === 'object' && !Array.isArray(element) ? element.singer : null
    if (singer) built.agent = singer
    else if (Array.isArray(element) && element.some(t => t === 'opposite' || t === 'right')) built.agent = 'v2'
    if (built.text || built.bgText) lines.push(built)
  }
  return {
    lines,
    doc: { agents, translations: {}, transliterations: {} },
    isrc: response?.metadata?.isrc || null,
    language: response?.metadata?.language || null,
  }
}

async function fromMirror(host, query, ctx) {
  const url = withQuery(`${host}/v2/lyrics/get`, {
    title: query.searchTitle || query.title,
    artist: query.searchArtist || query.artist,
    duration: query.duration ? Math.round(query.duration) : undefined,
    album: query.album,
    isrc: query.isrc,
  })
  const body = await getJson(url, { signal: ctx.signal, timeoutMs: 8000 })
  if (!body || !Array.isArray(body.lyrics) || !body.lyrics.length) return null
  const parsed = parse(body)
  return parsed.lines.length ? parsed : null
}

async function fetch(query, ctx = {}) {
  const hosts = lastGood ? [lastGood, ...MIRRORS.filter(m => m !== lastGood)] : MIRRORS
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  ctx.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await new Promise((resolve) => {
      let pending = hosts.length
      hosts.forEach(host => {
        fromMirror(host, query, { signal: controller.signal }).then(result => {
          if (result && pending > 0) {
            pending = 0
            lastGood = host
            resolve(result)
          } else if (--pending === 0) resolve(null)
        }, () => { if (--pending === 0) resolve(null) })
      })
    })
  } finally {
    controller.abort()
    ctx.signal?.removeEventListener('abort', onAbort)
  }
}

module.exports = { fetch, parse }
