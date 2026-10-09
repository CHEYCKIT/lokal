// yt-dlp searches for the Downloader page, shared by the desktop app and the web server.

const { spawn } = require('child_process')

function isTopicChannel(name) {
  return /\s-\sTopic$/i.test(String(name || ''))
}

function bestThumbnail(entry) {
  if (entry.thumbnail) return entry.thumbnail
  const list = Array.isArray(entry.thumbnails) ? entry.thumbnails.filter(t => t?.url) : []
  if (list.length) return list[list.length - 1].url
  return entry.id && /^[\w-]{11}$/.test(entry.id) ? `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg` : null
}

function mapSearchResult(entry) {
  const channel = entry.channel || entry.uploader || ''
  return {
    id: entry.id,
    title: entry.title,
    channel: isTopicChannel(channel) ? channel.replace(/\s-\sTopic$/i, '') : channel,
    // "Artist - Topic" channels carry the catalogue audio (album art, album tags).
    official: isTopicChannel(channel) || /VEVO$/i.test(channel) || /official audio/i.test(entry.title || ''),
    topic: isTopicChannel(channel),
    duration: entry.duration,
    thumbnail: bestThumbnail(entry),
    url: entry.webpage_url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : entry.url),
  }
}

function mapArtistResult(entry) {
  const channelId = entry.channel_id || entry.id
  const type = entry.playlist_id ? 'playlist' : 'channel'
  let url = entry.webpage_url || entry.url || null
  if (!url && type === 'channel' && channelId) url = `https://www.youtube.com/channel/${channelId}`
  return {
    id: entry.playlist_id || channelId || entry.id,
    title: entry.title || entry.uploader || entry.channel,
    channel: entry.uploader || entry.channel,
    type,
    thumbnail: bestThumbnail(entry),
    url,
    playlistId: entry.playlist_id || null,
    videoCount: entry.playlist_count || entry.channel_item_count || null,
  }
}

/**
 * @param track optional (proc) => proc, to register the process for shutdown
 */
function runJsonSearch(ytdlp, searchTerm, mapper, page = 1, limit = 10, track = p => p, { timeoutMs = 30000 } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1)
  const fetchCount = safePage * limit + 1
  const args = [`ytsearch${fetchCount}:${searchTerm}`, '--dump-json', '--flat-playlist', '--skip-download', '--quiet', '--no-warnings']

  return new Promise((resolve) => {
    let proc
    let settled = false
    let timer
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    try { proc = track(spawn(ytdlp, args, { windowsHide: true })) } catch {
      finish({ error: 'Failed to run yt-dlp', results: [], page: safePage, hasMore: false })
      return
    }
    timer = setTimeout(() => {
      try { proc.kill() } catch {}
      finish({ error: 'YouTube search timed out', results: [], page: safePage, hasMore: false })
    }, timeoutMs)
    let stdout = ''
    proc.stdout.on('data', data => { stdout += data.toString() })
    proc.on('close', () => {
      if (settled) return
      const mapped = []
      const seen = new Set()
      for (const line of stdout.trim().split(/\r?\n/).filter(Boolean)) {
        let row
        try { row = JSON.parse(line) } catch { continue }
        const item = mapper(row)
        if (!item?.id || !item?.url) continue
        const key = `${item.type || 'item'}:${item.id}:${item.url}`
        if (seen.has(key)) continue
        seen.add(key)
        mapped.push(item)
      }
      const start = (safePage - 1) * limit
      const end = start + limit
      // Within a page, the catalogue uploads come first. (Sorting across pages
      // would reshuffle results already on screen.)
      const pageItems = mapped.slice(start, end)
        .map((item, i) => ({ item, i }))
        .sort((a, b) => (Number(!!b.item.topic) - Number(!!a.item.topic)) || a.i - b.i)
        .map(x => x.item)
      finish({ results: pageItems, page: safePage, hasMore: mapped.length > end })
    })
    proc.on('error', () => finish({ error: 'Failed to run yt-dlp', results: [], page: safePage, hasMore: false }))
  })
}

module.exports = { runJsonSearch, mapSearchResult, mapArtistResult, isTopicChannel }
