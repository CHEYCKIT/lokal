import React, { useEffect, useRef, useState } from 'react'
import { Album, ArrowLeft, Download, Loader2, Play, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { artistPath } from '../releaseActions'
import { api } from '../api'
import { saveTracksToLibrary } from '../onlineTracks'
import { usePlayerStore } from '../store/player'
import { useTranslation } from '../i18n'

export default function AddonCollections({ query, source }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
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
      const result = item.type === 'playlist'
        ? await api.addonsPackages({ action: 'package.playlist', key: source.id.slice(2), id: item.id })
        : await api.addonAlbum(source.id, item.id)
      if (generation !== seq.current) return
      if (result?.error) throw new Error(result.error)
      setDetail({ ...result, type: item.type })
    } catch (error) { if (generation === seq.current) setMessage(error.message) }
    finally { if (generation === seq.current) setBusy(false) }
  }
  const openArtist = item => navigate(artistPath(item.title), {
    state: { name: item.title, anchor: { provider: source.id, artistId: item.id } },
  })
  const imageOf = item => item.thumbnail || item.artwork_url || item.artworkURL || item.image || item.image_url || ''
  const tracks = async () => {
    const result = await api.onlineSave(detail?.tracks || [])
    if (!Array.isArray(result)) throw new Error(result?.error || t('Could not load tracks'))
    return result.filter(Boolean)
  }
  const run = async action => {
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  if (!filters.length) return null
  const visible = detail?.type === 'artist' ? (detail.albums || []).map(album => ({ id: album.albumId, type: 'album', title: album.title, thumbnail: album.artwork_url, artist: detail.name })) : items
  const showingTracks = !!detail && detail.type !== 'artist'

  return (
    <section className="mt-5 space-y-3" aria-label={t('{source} collections', { source: source.label })}>
      <div className="flex flex-wrap items-center gap-2">
        {filters.map(option => (
          <button key={option.id} onClick={() => setFilter(option.id)}
            className={`rounded-lg border px-3 py-1 text-xs ${option.id === filter ? 'border-accent/40 text-accent' : 'border-border text-muted'}`}>
            {t(option.label)}
          </button>
        ))}
        {busy && <Loader2 size={14} className="animate-spin text-muted" />}
      </div>
      {message && <p role="status" className="text-xs text-muted">{message}</p>}

      {detail && (
        <div className="flex items-center gap-3">
          <button aria-label={t('Back to collections')} onClick={() => setDetail(null)} className="text-muted"><ArrowLeft size={14} /></button>
          <p className="min-w-0 flex-1 truncate text-sm text-text">{detail.title || detail.name}</p>
          {detail.tracks?.length > 0 && (
            <>
              <button disabled={busy} onClick={() => run(async () => playQueue(await tracks(), 0, { type: 'search', name: detail.title || detail.name }))}
                className="text-accent" title={t('Play collection')}><Play size={15} /></button>
              <button disabled={busy} onClick={() => run(async () => {
                const result = await saveTracksToLibrary(await tracks())
                setMessage(t('{started} queued · {existing} already in library · {failed} failed', result))
              })} className="text-accent" title={t('Save collection to library')}><Download size={15} /></button>
            </>
          )}
        </div>
      )}

      {showingTracks ? (
        <div className="space-y-1">
          {detail.tracks?.map((track, index) => (
            <button key={`${track.id}:${index}`} disabled={busy}
              onClick={() => run(async () => playQueue(await tracks(), index, { type: 'search', name: detail.title }))}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs hover:bg-elevated">
              <span className="w-5 text-muted">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-text">{track.title}</span>
              <span className="max-w-[40%] truncate text-muted">{track.artist}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className={`grid gap-x-3 gap-y-5 ${visible.some(item => item.type === 'artist') ? 'grid-cols-3 @sm:grid-cols-5 @md:grid-cols-6' : 'gap-2 @sm:grid-cols-2 @xl:grid-cols-3'}`}>
          {visible.map(item => (
            item.type === 'artist' ? (
              <button key={`${item.type}:${item.id}`} type="button" onClick={() => openArtist(item)}
                title={t('Open artist {name}', { name: item.title })}
                className="group flex min-w-0 flex-col items-center gap-2 text-center">
                <span className="aspect-square w-full max-w-36 overflow-hidden rounded-full border border-border bg-elevated flex items-center justify-center text-muted transition-all group-hover:border-accent/50 group-hover:shadow-lg group-hover:shadow-black/20">
                  {imageOf(item)
                    ? <img src={imageOf(item)} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" referrerPolicy="no-referrer" />
                    : <UserRound size={28} />}
                </span>
                <span className="w-full truncate text-xs font-medium text-text transition-colors group-hover:text-accent @md:text-sm">{item.title}</span>
                <span className="w-full truncate text-[10px] text-muted">{t('Artist')}</span>
              </button>
            ) : (
              <button key={`${item.type}:${item.id}`} disabled={busy} onClick={() => open(item)}
                className="group flex min-w-0 items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:border-accent/40">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-card text-muted">
                  {imageOf(item)
                    ? <img src={imageOf(item)} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                    : <Album size={18} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-text">{item.title}</span>
                  <span className="block truncate text-xs text-muted">{item.artist || item.channel || ''}{item.artist || item.channel ? ' · ' : ''}{t(item.type)}</span>
                </span>
              </button>
            )
          ))}
        </div>
      )}
    </section>
  )
}
