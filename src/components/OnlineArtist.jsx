// An artist who isn't in the library (the artist shortcut of a streamed
// song): their popular songs and their albums, from the catalogue, played
// and downloaded from the playback sources. Shown by the Artist page when
// the library has no such artist.

import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Disc3, Download, Music, Play, Radio } from 'lucide-react'
import ContextMenu, { useContextMenu } from './ContextMenu'
import DiscoveryImage from './DiscoveryImage'
import OnlineSongList from './OnlineSongList'
import { loadOnlineAlbum, loadOnlineArtistAlbums, loadOnlineArtistSongs, onlineAlbumPath } from '../onlineBrowse'
import { downloadOnline, playOnline } from '../onlineActions'
import { openRadio } from '../radioActions'
import { recommendationKey } from '../recommendations'
import { showToast } from './Toaster'
import { useAppStore } from '../store/player'

/** "a-earth-wind-fire" -> "Earth Wind Fire" (until the songs give the real name). */
export const nameFromSlug = id => String(id || '').replace(/^a-/, '').split('-').filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ')

export default function OnlineArtist({ id, name: givenName }) {
  const nav = useNavigate()
  const menu = useContextMenu()
  const userId = useAppStore(state => state.user?.id)
  const fallbackName = givenName || nameFromSlug(id)
  const [songs, setSongs] = useState({ loading: true, tracks: [], error: '' })
  const [albums, setAlbums] = useState({ loading: true, items: [] })
  const [busy, setBusy] = useState(false)
  const request = useRef(0)

  // The artist's own spelling ("Earth, Wind & Fire"), from their songs.
  const searched = songs.name || fallbackName
  const wanted = recommendationKey(searched)
  const name = songs.tracks.flatMap(track => [...(track.artists || []), track.artist]).find(artist => recommendationKey(artist) === wanted) || searched

  useEffect(() => {
    const version = ++request.current
    const isCurrent = () => version === request.current
    setSongs({ loading: true, tracks: [], error: '' })
    setAlbums({ loading: true, items: [] })
    ;(async () => {
      // "Drake, Future": the whole name first, then the first artist.
      const names = [...new Set([fallbackName, fallbackName.split(',')[0].trim()])].filter(Boolean)
      let result = { tracks: [], error: '' }
      let found = fallbackName
      for (const candidate of names) {
        result = await loadOnlineArtistSongs(candidate, undefined, { isCurrent })
        if (!isCurrent()) return
        found = candidate
        if (result.tracks.length) break
      }
      setSongs({ loading: false, tracks: result.tracks, error: result.error, name: found })
      const items = await loadOnlineArtistAlbums(found, result.tracks)
      if (isCurrent()) setAlbums({ loading: false, items })
    })()
    return () => { request.current++ }
  }, [fallbackName])

  const play = (selected, list = songs.tracks) => playOnline(list, { selected, name, path: `/artist/${id}` })
  const openAlbum = album => nav(onlineAlbumPath({ artist: album.artist || name, album: album.title, albumId: album.albumId }), { state: { artwork: album.artwork_url || null } })
  const albumTracks = async album => {
    const result = await loadOnlineAlbum({ artist: album.artist || name, album: album.title, albumId: album.albumId, artwork: album.artwork_url })
    if (!result.tracks.length) showToast(result.error || `No songs were found for “${album.title}”.`)
    return result.tracks
  }
  const withBusy = async work => {
    if (busy) return
    setBusy(true)
    try { await work() } finally { setBusy(false) }
  }
  const openAlbumMenu = (event, album) => menu.open(event, [
    { label: 'Play album', icon: Play, onSelect: async () => { const tracks = await albumTracks(album); if (tracks.length) playOnline(tracks, { name: album.title, path: onlineAlbumPath({ artist: album.artist || name, album: album.title, albumId: album.albumId }) }) } },
    { label: 'Download album', icon: Download, onSelect: () => withBusy(async () => { const tracks = await albumTracks(album); if (tracks.length) await downloadOnline(tracks, { label: `“${album.title}”` }) }) },
    { separator: true },
    { label: 'Open album', icon: Disc3, onSelect: () => openAlbum(album) },
  ])

  const image = songs.tracks.find(track => track.artwork_url)?.artwork_url || albums.items.find(album => album.artwork_url)?.artwork_url || ''

  return (
    <div className="pb-8">
      <div className="relative h-56 overflow-hidden">
        <button onClick={() => nav(-1)} className="absolute left-6 top-4 z-10 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur-sm transition-colors hover:text-white @md:left-8 @md:top-5">
          <ArrowLeft size={14} /> Back
        </button>
        {image ? <img src={image} alt="" className="h-full w-full object-cover opacity-30 blur-sm" /> : <div className="h-full w-full bg-gradient-to-b from-accent/8 to-transparent" />}
        <div className="absolute inset-0 bg-gradient-to-t from-base via-base/20" />
        <div className="absolute bottom-5 left-8 right-8 flex items-end gap-5">
          <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-elevated">
            {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <Music size={36} className="text-muted" />}
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-display uppercase tracking-widest text-muted">Artist · Online</p>
            <h1 className="truncate text-3xl font-display text-white">{name}</h1>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => play(songs.tracks[0])} disabled={!songs.tracks.length} className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-medium text-base transition-opacity hover:opacity-90 disabled:opacity-40"><Play size={15} fill="currentColor" /> Play</button>
              <button onClick={() => openRadio(nav, { artist: name, type: 'artist' }, userId)} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-4 py-2 text-sm text-white backdrop-blur-sm transition-colors hover:border-accent/50"><Radio size={15} /> Artist radio</button>
              <button onClick={() => withBusy(() => downloadOnline(songs.tracks, { label: `${name}'s popular songs` }))} disabled={!songs.tracks.length || busy} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-4 py-2 text-sm text-white backdrop-blur-sm transition-colors hover:border-accent/50 disabled:opacity-40"><Download size={15} /> {busy ? 'Finding songs…' : 'Download popular songs'}</button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-8 px-6 pt-6 @md:px-8">
        <section>
          <h2 className="mb-3 text-xs font-display uppercase tracking-widest text-muted">Popular</h2>
          {songs.loading
            ? <p role="status" className="text-sm text-muted">Loading {name}'s songs…</p>
            : songs.tracks.length
              ? <OnlineSongList tracks={songs.tracks.slice(0, 10)} showAlbum onPlay={track => play(track)} />
              : <p role="status" className="rounded-xl border border-border bg-elevated p-4 text-sm text-muted">{songs.error || `No songs were found for ${name}.`}</p>}
        </section>

        {(albums.loading ? !songs.loading : albums.items.length > 0) && (
          <section>
            <h2 className="mb-3 text-xs font-display uppercase tracking-widest text-muted">Albums</h2>
            {albums.loading
              ? <p role="status" className="text-sm text-muted">Loading albums…</p>
              : (
                <div className="grid grid-cols-2 gap-4 @md:grid-cols-4 @xl:grid-cols-6">
                  {albums.items.map(album => (
                    <button key={album.title} onClick={() => openAlbum(album)} onContextMenu={event => openAlbumMenu(event, album)} className="group text-left">
                      <div className="aspect-square overflow-hidden rounded-xl border border-border bg-elevated">
                        <DiscoveryImage item={album} type="album" src={album.artwork_url} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" fallback={<div className="flex h-full w-full items-center justify-center text-muted"><Disc3 size={32} /></div>} />
                      </div>
                      <p className="mt-2 truncate text-sm text-white">{album.title}</p>
                      <p className="truncate text-xs text-muted">{[album.release_type === 'single' ? 'Single' : album.release_type === 'ep' ? 'EP' : 'Album', album.year].filter(Boolean).join(' · ')}</p>
                    </button>
                  ))}
                </div>
              )}
          </section>
        )}
      </div>
      <ContextMenu menu={menu} />
    </div>
  )
}
