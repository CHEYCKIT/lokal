// The songs of an online album or artist page (see onlineBrowse.js). Double
// click (or the play button) plays from that song; a right click plays,
// queues, adds to a playlist, downloads or opens the song's album or artist.
// The song is found in the playback sources first for everything but going
// somewhere.

import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Disc3, Download, ListEnd, Play, Plus, Radio, User } from 'lucide-react'
import ContextMenu, { useContextMenu } from './ContextMenu'
import DiscoveryImage from './DiscoveryImage'
import { addToPlaylistMany, addToQueueMany, playNextMany } from '../trackActions'
import { downloadOnline, resolveOnline } from '../onlineActions'
import { onlineAlbumPath } from '../onlineBrowse'
import { artistPath } from '../releaseActions'
import { openRadio } from '../radioActions'
import { recommendationKey } from '../recommendations'
import { useAppStore } from '../store/player'

const time = seconds => {
  const value = Number(seconds) || 0
  return value ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : ''
}

/**
 * @param numbered       show track numbers (an album) instead of covers
 * @param showAlbum      show each song's album (an artist's songs)
 * @param highlightTitle the song to mark (the one playing when the page was opened)
 */
export default function OnlineSongList({ tracks, onPlay, numbered = false, showAlbum = false, highlightTitle = '' }) {
  const nav = useNavigate()
  const menu = useContextMenu()
  const userId = useAppStore(state => state.user?.id)
  const highlight = recommendationKey(highlightTitle)

  const withResolved = async (track, action) => {
    const [row] = await resolveOnline([track])
    if (row) action([row])
  }
  const openMenu = (event, track) => menu.open(event, [
    { label: 'Play', icon: Play, onSelect: () => onPlay(track) },
    { label: 'Play next', icon: Clock, onSelect: () => withResolved(track, playNextMany) },
    { label: 'Add to queue', icon: ListEnd, onSelect: () => withResolved(track, addToQueueMany) },
    { label: 'Add to playlist…', icon: Plus, onSelect: () => withResolved(track, addToPlaylistMany) },
    { label: 'Download song', icon: Download, onSelect: () => downloadOnline([track]) },
    { separator: true },
    track.album && { label: 'Go to album', icon: Disc3, onSelect: () => nav(onlineAlbumPath({ artist: track.album_artist || track.artist, album: track.album, albumId: track.albumId }), { state: { artwork: track.artwork_url || null, highlightTitle: track.title } }) },
    track.artist && { label: 'Go to artist', icon: User, onSelect: () => nav(artistPath(track.artists?.[0] || track.artist), { state: { name: track.artists?.[0] || track.artist } }) },
    { label: 'Start radio', icon: Radio, onSelect: () => openRadio(nav, track, userId) },
  ])

  return (
    <div className="flex flex-col">
      {tracks.map((track, index) => {
        const marked = highlight && recommendationKey(track.title) === highlight
        return (
          <div
            key={`${index}-${track.title}`}
            role="button"
            tabIndex={0}
            aria-label={`${track.title} by ${track.artist}`}
            onDoubleClick={() => onPlay(track)}
            onKeyDown={event => { if (event.key === 'Enter') onPlay(track) }}
            onContextMenu={event => openMenu(event, track)}
            className={`group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/5 ${showAlbum ? '@lg:grid-cols-[2rem_minmax(0,1fr)_minmax(0,14rem)_auto]' : ''} ${marked ? 'bg-accent/10' : ''}`}
          >
            <div className="relative flex h-8 w-8 items-center justify-center">
              {numbered
                ? <span className={`text-xs tabular-nums group-hover:opacity-0 ${marked ? 'text-accent' : 'text-muted'}`}>{track.track_num || track.trackNumber || index + 1}</span>
                : <div className="h-8 w-8 overflow-hidden rounded group-hover:opacity-40"><DiscoveryImage item={track} src={track.artwork_url} className="h-full w-full object-cover" /></div>}
              <button onClick={() => onPlay(track)} aria-label={`Play ${track.title}`} className="absolute inset-0 flex items-center justify-center text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"><Play size={14} fill="currentColor" /></button>
            </div>
            <div className="min-w-0">
              <p className={`truncate text-sm ${marked ? 'text-accent' : 'text-white'}`}>{track.title}</p>
              <p className="truncate text-xs text-muted">{track.artist}</p>
            </div>
            {showAlbum && <p className="hidden truncate text-xs text-muted @lg:block">{track.album || ''}</p>}
            <span className="text-xs tabular-nums text-subtle">{time(track.duration)}</span>
          </div>
        )
      })}
      <ContextMenu menu={menu} />
    </div>
  )
}
