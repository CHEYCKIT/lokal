// An album that isn't in the library, from a streamed song's album shortcut
// (or an online artist page): its songs from the catalogue, played and
// downloaded from the playback sources. When the library does have the
// album, its own page opens instead.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Disc3, Download, ListPlus, Play, Shuffle } from 'lucide-react'
import DiscoveryImage from '../components/DiscoveryImage'
import OnlineSongList from '../components/OnlineSongList'
import { usePageReady } from '../pageCache'
import { libraryAlbum, loadOnlineAlbum, onlineAlbumPath } from '../onlineBrowse'
import { downloadOnline, playOnline, resolveOnline } from '../onlineActions'
import { saveAsPlaylist } from '../trackActions'
import { artistPath } from '../releaseActions'
import { showToast } from '../components/Toaster'
import { plural } from '../plural'

const shuffled = list => {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export default function OnlineAlbum() {
  const nav = useNavigate()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const artist = params.get('artist') || ''
  const album = params.get('album') || ''
  const albumId = params.get('albumId') || ''
  const artwork = location.state?.artwork || ''
  const highlightTitle = location.state?.highlightTitle || ''
  const [state, setState] = useState({ loading: true, tracks: [], error: '', progress: '' })
  const [busy, setBusy] = useState('')
  const request = useRef(0)

  useEffect(() => {
    const version = ++request.current
    const isCurrent = () => version === request.current
    setState({ loading: true, tracks: [], error: '', progress: '' })
    ;(async () => {
      // In the library after all (downloaded since, say): its own page.
      const own = await libraryAlbum({ artist, album })
      if (!isCurrent()) return
      if (own) { nav('/albums', { replace: true, state: { album: own } }); return }
      const result = await loadOnlineAlbum({ artist, album, albumId, artwork }, undefined, {
        isCurrent, onProgress: progress => { if (isCurrent()) setState(current => ({ ...current, progress })) },
      })
      if (isCurrent()) setState({ loading: false, tracks: result.tracks, error: result.error || '', progress: '' })
    })()
    return () => { request.current++ }
  }, [artist, album, albumId]) // eslint-disable-line react-hooks/exhaustive-deps

  usePageReady(true)
  const { tracks } = state
  const cover = artwork || tracks.find(track => track.artwork_url)?.artwork_url || ''
  const path = onlineAlbumPath({ artist, album, albumId })
  const label = `“${album}”`
  const run = async (key, work) => {
    if (busy) return
    setBusy(key)
    try { await work() } finally { setBusy('') }
  }
  const play = (selected, list = tracks) => playOnline(list, { selected, name: album, path })
  const download = () => run('download', () => downloadOnline(tracks, { label }))
  const savePlaylist = () => run('playlist', async () => {
    const rows = await resolveOnline(tracks, { label })
    if (!rows.length) return
    const playlist = await saveAsPlaylist(album, rows, { description: `${album} by ${artist}`, coverURL: /^https:\/\//.test(cover) ? cover : undefined }).catch(() => null)
    showToast(playlist ? `Saved ${label} as a playlist.` : `Could not save ${label}.`)
  })
  const duration = useMemo(() => tracks.reduce((sum, track) => sum + (Number(track.duration) || 0), 0), [tracks])

  return (
    <div className="p-6 pb-10">
      <button onClick={() => nav(-1)} className="mb-5 inline-flex items-center gap-2 text-xs text-muted transition-colors hover:text-white">
        <ArrowLeft size={14} /> Back
      </button>
      <div className="mb-8 flex flex-col gap-5 @md:flex-row @md:items-end">
        <div className="h-44 w-44 flex-shrink-0 overflow-hidden rounded-2xl border border-border bg-elevated shadow-xl">
          <DiscoveryImage item={{ title: album, artist }} type="album" src={cover} className="h-full w-full object-cover" fallback={<div className="flex h-full w-full items-center justify-center text-muted"><Disc3 size={52} /></div>} />
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-display uppercase tracking-widest text-muted">Album · Online</p>
          <h1 className="truncate text-3xl font-display text-white">{album}</h1>
          <button onClick={() => nav(artistPath(artist), { state: { name: artist } })} className="mt-1 text-sm text-muted transition-colors hover:text-accent hover:underline">{artist}</button>
          {!state.loading && tracks.length > 0 && <p className="mt-1 text-xs text-subtle">{plural(tracks.length, 'song')}{duration ? ` · ${Math.round(duration / 60)} min` : ''}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => play(tracks[0])} disabled={!tracks.length} className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-medium text-base transition-opacity hover:opacity-90 disabled:opacity-40"><Play size={15} fill="currentColor" /> Play</button>
            <button onClick={() => { const list = shuffled(tracks); play(list[0], list) }} disabled={!tracks.length} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-white transition-colors hover:border-accent/50 disabled:opacity-40"><Shuffle size={15} /> Shuffle</button>
            <button onClick={download} disabled={!tracks.length || !!busy} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-white transition-colors hover:border-accent/50 disabled:opacity-40"><Download size={15} /> {busy === 'download' ? 'Finding songs…' : 'Download album'}</button>
            <button onClick={savePlaylist} disabled={!tracks.length || !!busy} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-white transition-colors hover:border-accent/50 disabled:opacity-40"><ListPlus size={15} /> {busy === 'playlist' ? 'Saving…' : 'Save as playlist'}</button>
          </div>
        </div>
      </div>
      {state.loading
        ? <p role="status" className="text-sm text-muted">{state.progress || `Loading ${album}…`}</p>
        : tracks.length
          ? <OnlineSongList tracks={tracks} numbered highlightTitle={highlightTitle} onPlay={track => play(track)} />
          : <p role="status" className="rounded-xl border border-border bg-elevated p-4 text-sm text-muted">{state.error || `No songs were found for ${album}.`}</p>}
    </div>
  )
}
