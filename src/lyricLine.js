// A song's lyrics for subtitle-style lyrics over a music video: whether
// they're synced (plain lyrics have no "now" to show under the picture).

import { useEffect, useState } from 'react'
import { api } from './api'

export function useLyricLines(track, enabled = true) {
  const [lyrics, setLyrics] = useState({ id: null, lines: [], synced: false })
  const id = enabled ? track?.id : null
  useEffect(() => {
    if (!id) return undefined
    let active = true
    api.getLyrics(track.id, track.title, track.artist, track.album, track.duration, track.file_path)
      .then(result => {
        if (!active) return
        const lines = Array.isArray(result?.lines) ? result.lines : []
        setLyrics({ id, lines, synced: result?.type === 'synced' && lines.length > 0 })
      })
      .catch(() => { if (active) setLyrics({ id, lines: [], synced: false }) })
    return () => { active = false }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const mine = lyrics.id === id
  return { loaded: mine, synced: mine && lyrics.synced, lines: mine ? lyrics.lines : [] }
}

/**
 * The index of the line to show at `t`: the last one started, or -1 before
 * the first and once a line has been over a while with nothing new yet.
 */
export function subtitleIndex(lines, t, endOf, linger = 1.2) {
  let index = -1
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i]?.time ?? 0) <= t) index = i
    else break
  }
  const line = lines[index]
  if (line && !line.gap && t > endOf(line) + linger) return -1
  return index
}
