// What can be done with one or several releases (albums, EPs, singles): play,
// queue, add to a playlist, delete from the library. Shared by the Albums grid
// and the releases on artist pages, from a right click or a selection bar.
//
//   const releases = useReleaseActions()
//   <div onContextMenu={(e) => releases.openMenu(e, [album])} />
//   {releases.elements}   // the menu and the delete confirmation

import React, { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, ExternalLink, ListEnd, Play, Plus, Trash2, User } from 'lucide-react'
import ContextMenu, { useContextMenu } from './components/ContextMenu'
import DeleteTracksDialog from './components/DeleteTracksDialog'
import { api } from './api'
import { usePlayerStore } from './store/player'
import { makeAlbumContext } from './playbackContext'
import { addToPlaylistMany, addToQueueMany, libraryTracks, playNextMany } from './trackActions'

/** An artist's page from their name ("/artist/a-the-beatles"). */
export function artistPath(name) {
  const slug = String(name || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown'
  return `/artist/a-${slug}`
}

/** A release's identity (title and artist), to select it by. */
export const releaseKey = (album) => `${String(album.title || '').toLowerCase()}|${String(album.album_artist || album.artists || '').toLowerCase()}`

/**
 * @param onDeleted     called with the deleted track ids
 * @param goToArtist    offer "Go to artist" (not on the artist's own page)
 */
export function useReleaseActions({ onDeleted, goToArtist = true } = {}) {
  const navigate = useNavigate()
  const menu = useContextMenu()
  const [deleteRequest, setDeleteRequest] = useState(null)

  const tracksOf = async (albums) => (await Promise.all(albums.map(album => api.getAlbumTracks(album).catch(() => []))))
    .flatMap(list => (Array.isArray(list) ? list : []))
  // Every action fetches the releases' songs first: one at a time, so a second
  // click while that runs doesn't queue (or ask to delete) them twice.
  const busy = useRef(false)
  const withTracks = async (albums, use) => {
    if (busy.current) return
    busy.current = true
    try {
      await use(await tracksOf(albums))
    } finally {
      busy.current = false
    }
  }

  const askDelete = (albums) => withTracks(albums, (all) => {
    const tracks = libraryTracks(all)
    if (tracks.length) setDeleteRequest({ tracks, what: albums.length === 1 ? albums[0].title : `${albums.length} releases` })
  })

  /** The menu for `albums` (right click). */
  const menuItems = (albums) => {
    const count = albums.length > 1 ? ` ${albums.length} releases` : ''
    const one = albums.length === 1 ? albums[0] : null
    const run = (use) => () => withTracks(albums, use)
    return [
      { label: `Play${count}`, icon: Play, onSelect: run(tracks => tracks.length && usePlayerStore.getState().playQueue(tracks, 0, one ? makeAlbumContext(one) : null)) },
      { label: 'Play next', icon: Clock, onSelect: run(playNextMany) },
      { label: 'Add to queue', icon: ListEnd, onSelect: run(addToQueueMany) },
      { label: 'Add to playlist…', icon: Plus, onSelect: run(addToPlaylistMany) },
      one && { separator: true },
      one && { label: 'Open', icon: ExternalLink, onSelect: () => navigate('/albums', { state: { album: one } }) },
      one && goToArtist && { label: 'Go to artist', icon: User, onSelect: () => navigate(artistPath(one.album_artist || one.artists)) },
      { separator: true },
      { label: albums.length > 1 ? `Delete${count} from library` : 'Delete from library', icon: Trash2, danger: true, onSelect: () => askDelete(albums) },
    ].filter(Boolean)
  }

  /** The selection bar's buttons for `albums`. */
  const barActions = (albums) => {
    const run = (use) => () => withTracks(albums, use)
    return [
      { label: 'Play', icon: Play, onClick: run(tracks => tracks.length && usePlayerStore.getState().playQueue(tracks, 0, null)) },
      { label: 'Play next', icon: Clock, onClick: run(playNextMany) },
      { label: 'Add to queue', icon: ListEnd, onClick: run(addToQueueMany) },
      { label: 'Add to playlist', icon: Plus, onClick: run(addToPlaylistMany) },
      { label: 'Delete', icon: Trash2, danger: true, onClick: () => askDelete(albums) },
    ]
  }

  const elements = (
    <>
      <DeleteTracksDialog request={deleteRequest} onClose={() => setDeleteRequest(null)} onDone={onDeleted} />
      <ContextMenu menu={menu} />
    </>
  )

  return {
    menu,
    openMenu: (event, albums) => menu.open(event, menuItems(albums)),
    menuItems,
    barActions,
    askDelete,
    // Songs too (the album page), through the same confirmation.
    askDeleteTracks: (tracks) => {
      const deletable = libraryTracks(tracks)
      if (deletable.length) setDeleteRequest({ tracks: deletable, title: deletable.length === 1 ? deletable[0].title : null })
    },
    elements,
  }
}
