import React, { useEffect, useRef, useState } from 'react'
import { Album, ArrowLeft, Download, Loader2, Play } from 'lucide-react'
import { api } from '../api'
import { saveTracksToLibrary } from '../onlineTracks'
import { usePlayerStore } from '../store/player'

export default function AddonCollections({ query, source }) {
  const filters = (source.filters || []).filter(filter => !/^(songs?|tracks?)$/.test(filter.id))
  const [filter, setFilter] = useState(filters[0]?.id || '')
  const [items, setItems] = useState([])
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const seq = useRef(0)
  const playQueue = usePlayerStore(state => state.playQueue)
  useEffect(() => {
    const generation = ++seq.current
    setDetail(null); setMessage(''); setItems([])
    if (!filter) return
    setBusy(true)
    const timer = setTimeout(async () => {
      try {
        const result = await api.addonsPackages({ action: 'package.search', key: source.id.slice(2), query, filter })
        if (generation !== seq.current) return
        if (result?.error) throw new Error(result.error)
        setItems(Array.isArray(result) ? result : [])
      } catch (error) { if (generation === seq.current) setMessage(error.message) }
      finally { if (generation === seq.current) setBusy(false) }
    }, 500)
    return () => { clearTimeout(timer); seq.current++ }
  }, [query, source.id, filter])
  const open = async item => {
    const generation = seq.current
    setBusy(true); setMessage('')
    try {
      const result = item.type === 'artist' ? await api.addonArtist(source.id, item.id)
        : item.type === 'playlist' ? await api.addonsPackages({ action: 'package.playlist', key: source.id.slice(2), id: item.id })
          : await api.addonAlbum(source.id, item.id)
      if (generation !== seq.current) return
      if (result?.error) throw new Error(result.error)
      setDetail({ ...result, type: item.type })
    } catch (error) { if (generation === seq.current) setMessage(error.message) }
    finally { if (generation === seq.current) setBusy(false) }
  }
  const tracks = async () => {
    const result = await api.onlineSave(detail?.tracks || [])
    if (!Array.isArray(result)) throw new Error(result?.error || 'Could not load tracks')
    return result.filter(Boolean)
  }
  const run = async action => {
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  if (!filters.length) return null
  const visible = detail?.type === 'artist' ? (detail.albums || []).map(album => ({ id: album.albumId, type: 'album', title: album.title, thumbnail: album.artwork_url, artist: detail.name })) : items
  return <section className="mt-5 space-y-3" aria-label={`${source.label} collections`}>
    <div className="flex flex-wrap items-center gap-2">
      {filters.map(option => <button key={option.id} onClick={() => setFilter(option.id)} className={`rounded-lg border px-3 py-1 text-xs ${option.id === filter ? 'border-accent/40 text-accent' : 'border-border text-muted'}`}>{option.label}</button>)}
      {busy && <Loader2 size={14} className="animate-spin text-muted" />}
    </div>
    {message && <p role="status" className="text-xs text-muted">{message}</p>}
    {detail && <div className="flex items-center gap-3"><button aria-label="Back to collections" onClick={() => setDetail(null)} className="text-muted"><ArrowLeft size={14} /></button><p className="min-w-0 flex-1 truncate text-sm text-text">{detail.title || detail.name}</p>{detail.tracks?.length > 0 && <><button disabled={busy} onClick={() => run(async () => playQueue(await tracks(), 0, { type: 'search', name: detail.title || detail.name }))} className="text-accent" title="Play collection"><Play size={15} /></button><button disabled={busy} onClick={() => run(async () => { const result = await saveTracksToLibrary(await tracks()); setMessage(`${result.started} queued · ${result.existing} already in library · ${result.failed} failed`) })} className="text-accent" title="Save collection to library"><Download size={15} /></button></>}</div>}
    {detail?.type !== 'artist' && detail ? <div className="space-y-1">{detail.tracks?.map((track, index) => <button key={`${track.id}:${index}`} disabled={busy} onClick={() => run(async () => playQueue(await tracks(), index, { type: 'search', name: detail.title }))} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs hover:bg-elevated"><span className="w-5 text-muted">{index + 1}</span><span className="min-w-0 flex-1 truncate text-text">{track.title}</span><span className="max-w-[40%] truncate text-muted">{track.artist}</span></button>)}</div>
      : <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{visible.map(item => <button key={`${item.type}:${item.id}`} disabled={busy} onClick={() => open(item)} className="flex items-center gap-3 rounded-xl border border-border p-3 text-left hover:border-accent/40"><div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-card text-muted">{item.thumbnail ? <img src={item.thumbnail} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <Album size={18} />}</div><div className="min-w-0"><p className="truncate text-sm text-text">{item.title}</p><p className="truncate text-xs text-muted">{item.artist} · {item.type}</p></div></button>)}</div>}
  </section>
}
