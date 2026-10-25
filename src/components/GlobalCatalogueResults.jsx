import React, { useEffect, useRef, useState } from 'react'
import { Disc3, Music, Play, User } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { playRecommendationPool } from '../recommendationPlayback'
import { showToast, showLoadingToast } from './Toaster'
import { onlineAlbumPath } from '../onlineBrowse'
import QualityImage from './QualityImage'

const EMPTY = { tracks: [], albums: [], artists: [] }
const PAGE_SIZE = 25

/** Global metadata never chooses a streaming provider. A clicked title is
 * matched through Playback > Source Priority by the existing resolver. */
export default function GlobalCatalogueResults({ query }) {
  const nav = useNavigate()
  const q = String(query || '').trim()
  const [results, setResults] = useState(EMPTY)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const seq = useRef(0)
  const locale = (typeof navigator !== 'undefined' ? navigator.language : 'en-US').split('-')[1] || 'US'
  useEffect(() => {
    const version = ++seq.current
    setResults(EMPTY); setError(''); setHasMore(false)
    if (q.length < 2) { setBusy(false); return }
    setBusy(true)
    const timer = setTimeout(async () => {
      try {
        const found = await api.globalCatalogueSearch(q, { country: locale, limit: PAGE_SIZE })
        if (version !== seq.current) return
        if (found?.error) throw new Error(found.error)
        const clean = {
          tracks: Array.isArray(found?.tracks) ? found.tracks : [],
          albums: Array.isArray(found?.albums) ? found.albums : [],
          artists: Array.isArray(found?.artists) ? found.artists : [],
        }
        setResults(clean); setHasMore(clean.tracks.length === PAGE_SIZE)
      } catch (e) {
        if (version === seq.current) setError(e?.message || 'Global catalogue unavailable.')
      } finally {
        if (version === seq.current) setBusy(false)
      }
    }, 350)
    return () => { clearTimeout(timer); seq.current++ }
  }, [q, locale])

  const more = async () => {
    if (loadingMore) return
    const version = seq.current
    setLoadingMore(true)
    try {
      const found = await api.globalCatalogueSearch(q, { country: locale, limit: PAGE_SIZE, offset: results.tracks.length })
      if (version !== seq.current) return
      const rows = Array.isArray(found?.tracks) ? found.tracks : []
      const known = new Set(results.tracks.map(t => t.id))
      setResults(state => ({ ...state, tracks: [...state.tracks, ...rows.filter(t => !known.has(t.id))] }))
      setHasMore(rows.length === PAGE_SIZE)
    } catch (e) {
      if (version === seq.current) setError(e?.message || 'Could not load more songs.')
    } finally { if (version === seq.current) setLoadingMore(false) }
  }

  const play = async song => {
    if (playing) return
    setPlaying(song.id)
    const toast = showLoadingToast('Finding “' + song.title + '” through your source priority…')
    try {
      // Only metadata goes to the resolver; do NOT send Apple's catalogue ID
      // as an exact provider/stream ID.
      const candidates = results.tracks.map(({ id, title, artist, album, duration, artwork_url }) => (
        { id, title, artist, album, duration, artwork_url }
      ))
      const selected = candidates.find(row => row.id === song.id)
      const ok = await playRecommendationPool(candidates, {
        selected, context: { type: 'search', id: q, name: 'Global: ' + q },
        returnAfterStart: true,
      })
      toast.close()
      if (ok === false) showToast('No configured playback source could play “' + song.title + '”.')
    } catch (e) {
      toast.close()
      showToast(e?.message || 'Could not resolve this song.')
    } finally { setPlaying('') }
  }

  if (q.length < 2) return null
  return <section className="space-y-3">
    <div>
      <h2 className="text-xs font-display uppercase tracking-widest text-white">Global</h2>
      <p className="mt-1 text-[11px] text-muted">Apple Music catalogue · audio resolved in your Playback Source Priority order</p>
    </div>
    {busy && <p className="text-xs text-muted" role="status">Searching the global catalogue…</p>}
    {error && <p className="text-xs text-muted" role="status">{error} <button className="underline" onClick={() => { const old = q; setError(''); api.globalCatalogueSearch(old, { country: locale }).then(setResults).catch(e => setError(e.message)) }}>Retry</button></p>}
    {!busy && !error && !results.tracks.length && !results.albums.length && !results.artists.length &&
      <p className="text-xs text-muted">No catalogue matches found.</p>}
    {results.tracks.length > 0 && <div>
      <p className="mb-1 text-[11px] font-medium uppercase text-muted">Songs</p>
      <div className="space-y-0.5">
        {results.tracks.map(row => <button key={row.id} disabled={!!playing} onClick={() => play(row)}
          className="w-full flex items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.06] disabled:opacity-60">
          <span className="h-11 w-11 overflow-hidden rounded-md bg-card shrink-0">{row.artwork_url ? <QualityImage src={row.artwork_url} className="w-full h-full object-cover" /> : <span className="flex h-full items-center justify-center"><Music size={18}/></span>}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{row.title}</span><span className="block truncate text-xs text-muted">{row.artist}{row.album ? ' · ' + row.album : ''}</span></span>
          <Play size={15} className="text-muted shrink-0"/>
        </button>)}
      </div>
      {hasMore && <button disabled={loadingMore} onClick={more} className="mt-2 text-xs text-accent hover:underline disabled:opacity-50">{loadingMore ? 'Loading…' : 'More global songs'}</button>}
    </div>}
    {results.albums.length > 0 && <div>
      <p className="mb-2 text-[11px] font-medium uppercase text-muted">Albums</p>
      <div className="grid grid-cols-3 @sm:grid-cols-5 gap-2">{results.albums.slice(0, 10).map(row =>
        <button key={row.id} className="min-w-0 text-left" onClick={() => nav(onlineAlbumPath({ artist: row.artist, album: row.title }), { state: { artwork: row.artwork_url } })}>
          <span className="block aspect-square rounded-md overflow-hidden bg-card">{row.artwork_url ? <QualityImage src={row.artwork_url} className="w-full h-full object-cover"/> : <span className="h-full flex items-center justify-center"><Disc3 size={20}/></span>}</span>
          <span className="block truncate text-xs mt-1">{row.title}</span><span className="block truncate text-[11px] text-muted">{row.artist}</span>
        </button>)}</div>
    </div>}
    {results.artists.length > 0 && <div>
      <p className="mb-2 text-[11px] font-medium uppercase text-muted">Artists</p>
      <div className="flex flex-wrap gap-2">{results.artists.slice(0, 10).map(row =>
        <button key={row.id} onClick={() => nav('/releases', { state: { artist: row.title } })}
          className="rounded-full bg-elevated border border-border px-3 py-1.5 text-xs text-muted hover:text-white"><User size={12} className="inline mr-1"/>{row.title}</button>)}</div>
    </div>}
  </section>
}
