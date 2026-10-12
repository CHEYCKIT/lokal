// A queued song, made ready for the TV: an address on the cast media server
// it can fetch, what it is (its MIME type), and what the TV shows about it
// (title, artist, album, cover).
//
//  - A library file the TV can play is served as it is.
//  - One it can't (ALAC, AIFF, FLAC above 24-bit / 96 kHz, DSD, WMA...) is
//    converted once into the cast cache (electron/cache.js keeps it within
//    the cache limit) and served from there.
//  - An online song is relayed through Lokal; if the TV refuses it, it's
//    converted from its stream instead ("convert": a retry after an error).

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { planFile, convertArgs, streamMime } = require('./formats')

const IMAGE_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }

function runFfmpeg(ffmpeg, args, { timeoutMs = 10 * 60 * 1000, spawn = require('child_process').spawn } = {}) {
  return new Promise((resolve, reject) => {
    let err = ''
    let proc
    try { proc = spawn(ffmpeg || 'ffmpeg', args, { windowsHide: true }) } catch (e) { reject(e); return }
    const timer = setTimeout(() => { try { proc.kill('SIGKILL') } catch {} }, timeoutMs)
    proc.stderr?.on('data', d => { err = (err + d.toString()).slice(-2000) })
    proc.on('error', e => { clearTimeout(timer); reject(e) })
    proc.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited with ${code}`))
    })
  })
}

/**
 * Builds the preparer. Everything Lokal-specific is passed in, so the tests
 * can stand it up on its own.
 */
function createCastMedia({
  server,
  cacheDir = () => null,
  ffmpeg = () => null,
  quality = () => 'max',
  trackRow = () => null, // id -> the library row (codec, sample rate, bit depth, artwork)
  streamRef = () => null, // track -> { provider, id } for an online song
  resolveStream = async () => { throw new Error('No online streams') }, // (provider, id) -> { url, headers, mime }
  fetchStream = async () => { throw new Error('No online streams') }, // (provider, id, { range, signal }) -> { res, mime }
  probe = async () => null, // file -> { codec, sampleRate, bitDepth, lossless }
  convert = runFfmpeg,
  trimCache = () => {},
  log = () => {},
} = {}) {
  const converting = new Map() // destination -> Promise<path>
  const inUse = new Map() // converted file the TV may fetch -> how many prepared songs use it
  const use = file => inUse.set(file, (inUse.get(file) || 0) + 1)

  async function convertOnce(dest, args) {
    if (fs.existsSync(dest)) {
      try { const now = new Date(); fs.utimesSync(dest, now, now) } catch {}
      return dest
    }
    if (converting.has(dest)) return converting.get(dest)
    const job = (async () => {
      const temp = `${dest}.part${path.extname(dest)}`
      try {
        args[args.length - 1] = temp
        await convert(ffmpeg(), args)
        fs.renameSync(temp, dest)
        // Kept: this file, and every converted file the TV holds or plays now.
        try { trimCache([dest, ...inUse.keys()]) } catch {}
        return dest
      } catch (error) {
        try { fs.unlinkSync(temp) } catch {}
        throw error
      }
    })().finally(() => converting.delete(dest))
    converting.set(dest, job)
    return job
  }

  function cachePath(identity, plan) {
    const dir = cacheDir()
    if (!dir) throw new Error('No cache folder to convert into')
    fs.mkdirSync(dir, { recursive: true })
    const key = crypto.createHash('sha1').update(`${identity}\u0000${plan.to}\u0000${plan.rate}\u0000${plan.depth}`).digest('hex').slice(0, 24)
    return path.join(dir, key + plan.ext)
  }

  function artworkFor(row, deviceHost) {
    if (row.artwork_path && fs.existsSync(row.artwork_path)) {
      const mime = IMAGE_MIME[path.extname(row.artwork_path).toLowerCase()] || 'image/jpeg'
      const added = server.add({ kind: 'file', path: row.artwork_path, mime }, 'cover' + (path.extname(row.artwork_path) || '.jpg'))
      return { url: server.urlFor(added.path, deviceHost), key: added.key }
    }
    if (/^https?:\/\//i.test(String(row.artwork_url || ''))) return { url: row.artwork_url, key: null }
    return { url: null, key: null }
  }

  /**
   * @param track the queued track (from the player)
   * @param options { deviceHost, convert: true to convert even what could be relayed (a retry) }
   * @returns { trackId, url, mime, duration, metadata, keys, converted }
   */
  async function prepare(track, { deviceHost, convert: forceConvert = false } = {}) {
    const row = { ...(trackRow(track?.id) || {}), ...track }
    if (!row?.id) throw new Error('Nothing to play')
    const keys = []
    const files = [] // converted files it plays from (kept by the cache while in use)
    let url = null
    let mime = null
    let converted = false
    const ref = streamRef(row)
    if (ref) {
      if (forceConvert) {
        const stream = await resolveStream(ref.provider, ref.id)
        const plan = { action: 'convert', to: 'flac', ext: '.flac', mime: 'audio/flac', rate: null, depth: 24 }
        // Lossy sources stay lossy: AAC is plenty for what YouTube or SoundCloud send.
        if (!/flac|wav|alac/i.test(String(stream.mime || ''))) Object.assign(plan, { to: 'aac', ext: '.m4a', mime: 'audio/mp4', depth: null })
        const dest = cachePath(`${ref.provider}:${ref.id}`, plan)
        const source = stream.file || stream.url
        await convertOnce(dest, convertArgs(source, dest, plan, { headers: stream.file ? null : stream.headers }))
        use(dest)
        files.push(dest)
        const added = server.add({ kind: 'file', path: dest, mime: plan.mime }, 'song' + plan.ext)
        keys.push(added.key)
        url = server.urlFor(added.path, deviceHost)
        mime = plan.mime
        converted = true
      } else {
        const stream = await resolveStream(ref.provider, ref.id)
        mime = streamMime(stream.mime)
        const added = server.add({
          kind: 'relay', mime, label: `${ref.provider}:${ref.id}`,
          fetchRange: async (range, signal) => (await fetchStream(ref.provider, ref.id, { range, signal })).res,
        }, 'song')
        keys.push(added.key)
        url = server.urlFor(added.path, deviceHost)
      }
    } else {
      const file = String(row.file_path || '')
      if (!file || file.startsWith('ghost://') || !fs.existsSync(file)) throw new Error('This song has no file to play')
      let info = { file, codec: row.codec, sampleRate: row.sample_rate, bitDepth: row.bit_depth, lossless: row.lossless }
      if (!info.codec) info = { ...info, ...(await probe(file).catch(() => null) || {}) }
      let plan = planFile(info, quality())
      if (forceConvert && plan.action === 'direct') plan = { ...planFile({ ...info, codec: 'ALAC' }, quality()), to: info.lossless || /flac|pcm|wav/i.test(String(info.codec)) ? 'flac' : 'aac' }
      if (plan.action === 'direct') {
        const added = server.add({ kind: 'file', path: file, mime: plan.mime }, 'song' + path.extname(file).toLowerCase())
        keys.push(added.key)
        url = server.urlFor(added.path, deviceHost)
        mime = plan.mime
      } else {
        if (plan.to === 'aac') Object.assign(plan, { ext: '.m4a', mime: 'audio/mp4' })
        let stat = null
        try { stat = fs.statSync(file) } catch {}
        const dest = cachePath(`${file}\u0000${stat?.size}\u0000${stat?.mtimeMs}`, plan)
        await convertOnce(dest, convertArgs(file, dest, plan))
        use(dest)
        files.push(dest)
        const added = server.add({ kind: 'file', path: dest, mime: plan.mime }, 'song' + plan.ext)
        keys.push(added.key)
        url = server.urlFor(added.path, deviceHost)
        mime = plan.mime
        converted = true
      }
    }
    const art = artworkFor(row, deviceHost)
    if (art.key) keys.push(art.key)
    return {
      trackId: String(row.id),
      url,
      mime,
      converted,
      duration: Number(row.duration) > 0 ? Number(row.duration) : null,
      metadata: {
        metadataType: 3, // MusicTrackMediaMetadata
        title: row.title || '',
        artist: row.artist || '',
        albumName: row.album || '',
        ...(art.url ? { images: [{ url: art.url }] } : {}),
      },
      keys,
      files,
    }
  }

  /** Takes a prepared song's addresses down. */
  function release(prepared) {
    for (const key of prepared?.keys || []) server.remove(key)
    for (const file of prepared?.files || []) {
      const left = (inUse.get(file) || 0) - 1
      if (left > 0) inUse.set(file, left)
      else inUse.delete(file)
    }
  }

  /** A song's cover for Lokal's receiver (its Up Next row): { url, key } (key: to take it down). */
  function artwork(track, { deviceHost } = {}) {
    const row = { ...(trackRow(track?.id) || {}), ...track }
    return artworkFor(row, deviceHost)
  }

  return { prepare, release, artwork, unpublish: key => { if (key) server.remove(key) } }
}

module.exports = { createCastMedia, runFfmpeg }
