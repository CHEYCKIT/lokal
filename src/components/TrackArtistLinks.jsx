import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { isOnlineTrack } from '../onlineBrowse.js'
import { artistIdFromName } from '../artistId.js'
import { navigateToTrackArtist } from '../artistLink'
import { artistCreditParts, keepCommaSet, setSplitWords } from '../artistNames'

/**
 * The artists a track is linked to (as the library split them: "A x B feat.
 * C" is three), in credit order. A streamed song uses the names its source
 * gives. Empty while loading or for a single artist's song.
 */
let splitWordsRequest = null
function loadSplitWords() {
  if (splitWordsRequest) return splitWordsRequest
  splitWordsRequest = Promise.resolve(api.getArtistSplitWords?.())
    .then(result => { if (Array.isArray(result?.words)) setSplitWords(result.words) })
    .catch(() => {})
  return splitWordsRequest
}

function useLinkedArtists(track) {
  const [linked, setLinked] = useState({ trackId: null, artists: [] })
  const online = isOnlineTrack(track)
  const trackId = track?.id ?? null
  const artistText = track?.artist || ''
  useEffect(() => {
    if (!trackId || online) return undefined
    let alive = true
    Promise.resolve(api.artistsForTrack?.(trackId))
      .then(rows => { if (alive) setLinked({ trackId, artists: Array.isArray(rows) ? rows : [] }) })
      .catch(() => { if (alive) setLinked({ trackId, artists: [] }) })
    return () => { alive = false }
  }, [trackId, online, artistText])
  if (!track) return []
  if (online) {
    const names = Array.isArray(track.artists) ? track.artists.map(name => String(name || '').trim()).filter(Boolean) : []
    return names.length > 1 ? names.map(name => ({ id: artistIdFromName(name), name })) : []
  }
  return linked.trackId === trackId ? linked.artists : []
}

/** The credit split into linked names and the text between them ("A", " feat. ", "B"). */
function creditSegments(credit, artists) {
  const lower = credit.toLowerCase()
  const segments = []
  let cursor = 0
  for (const artist of artists) {
    const at = lower.indexOf(String(artist.name).toLowerCase(), cursor)
    if (at < 0) return null
    if (at > cursor) segments.push({ text: credit.slice(cursor, at) })
    segments.push({ text: credit.slice(at, at + artist.name.length), artist })
    cursor = at + artist.name.length
  }
  if (cursor < credit.length) segments.push({ text: credit.slice(cursor) })
  return segments
}

/**
 * A track's artist credit with each artist its own link to their page; a
 * single artist's song is one link as before.
 */
export default function TrackArtistLinks({ track, nav, keepCommaArtists = [], className = '', linkClassName = '', onContextMenu }) {
  const artists = useLinkedArtists(track)
  const [, refreshSplitWords] = useState(0)
  useEffect(() => {
    let active = true
    loadSplitWords().then(() => { if (active) refreshSplitWords(value => value + 1) })
    const changed = event => {
      if (!Array.isArray(event.detail)) return
      setSplitWords(event.detail)
      refreshSplitWords(value => value + 1)
    }
    window.addEventListener('lokal:split-words-updated', changed)
    return () => { active = false; window.removeEventListener('lokal:split-words-updated', changed) }
  }, [])
  if (!track?.artist) return null
  const credit = String(track.artist)
  if (artists.length < 2) {
    return (
      <button type="button" onClick={() => navigateToTrackArtist(nav, track, keepCommaArtists)} onContextMenu={onContextMenu}
        title={`Go to artist: ${credit}`} className={`${linkClassName} ${className}`}>
        {credit}
      </button>
    )
  }
  const open = (artist) => nav(`/artist/${artist.id}`, { state: { name: artist.name } })
  const artistByName = new Map(artists.map(artist => [artist.name.toLocaleLowerCase(), artist]))
  const segments = artistCreditParts(credit, keepCommaSet(keepCommaArtists), artists.map(artist => artist.name))
    .map(segment => segment.artist ? { ...segment, artist: artistByName.get(String(segment.artist).toLocaleLowerCase()) || artists.find(a => a.name.toLocaleLowerCase() === String(segment.artist).toLocaleLowerCase()) } : segment)
  return (
    <span className={className} onContextMenu={onContextMenu}>
      {segments.map((segment, i) => segment.artist ? (
        <button key={i} type="button" onClick={() => open(segment.artist)} title={`Go to artist: ${segment.artist.name}`} className={linkClassName}>
          {segment.text}
        </button>
      ) : <span key={i}>{segment.text}</span>)}
    </span>
  )
}
