import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Music, Play, Clock, Sparkles, Radio, History, ListEnd, ListPlus, Plus, Disc3, User, ExternalLink, RefreshCw, Youtube } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import TrackList from '../components/TrackList'
import FadeImg from '../components/FadeImg'
import SectionSwap from '../components/SectionSwap'
import { api } from '../api'
import { useCachedState, usePageReady } from '../pageCache'
import { plural } from '../plural'
import ContextMenu, { useContextMenu } from '../components/ContextMenu'
import { showToast } from '../components/Toaster'
import { addToPlaylistMany, addToQueueMany, playNextMany, saveAsPlaylist } from '../trackActions'
import { artistPath } from '../releaseActions'
import ProviderConnections from '../components/ProviderConnections'
import { trackArtURL } from '../onlineTracks'
import { openRadio } from '../radioActions'

// "30 September 2026": saved mixes and suggestions change daily, so the
// playlist says which day's it is.
const today = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
/** A mix's name as a playlist's ("Radiohead" → "Radiohead Mix"). */
const mixTitle = (mix) => (mix.type === 'artist' ? `${mix.name} Mix` : mix.name)

function MixCard({ mix, onClick, onSave, saving, onContextMenu }) {
  const artSrc = (t) => t.artwork_path
    ? (api.isElectron ? `file://${t.artwork_path}` : api.artworkURL(t.id))
    : null

  // One track per distinct cover: the web app asks for a cover by track id
  // (a bare path came out as /artwork/undefined, so mixes showed no art).
  const arts = [...new Map(mix.tracks.filter(t => t.artwork_path).map(t => [t.artwork_path, t])).values()].slice(0, 4)

  const getMixTypeLabel = (type) => {
    switch (type) {
      case 'daily': return 'Daily Mix'
      case 'recent': return 'New Arrivals'
      case 'top': return 'Most Played'
      case 'discovery': return 'Discovery'
      default: return type
    }
  }

  return (
    <motion.div whileHover={{ scale: 1.03 }} className="relative group" onContextMenu={onContextMenu}>
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={onClick}
        className="w-full flex flex-col gap-3 p-3 bg-elevated border border-border rounded-xl hover:border-accent/30 transition-all text-left"
      >
        <div className="w-full aspect-square rounded-lg overflow-hidden bg-card relative">
          {arts.length === 0 && <div className="w-full h-full flex items-center justify-center text-subtle"><Radio size={36} /></div>}
          {arts.length === 1 && <FadeImg src={artSrc(arts[0])} className="w-full h-full object-cover" />}
          {arts.length > 1 && (
            <div className="w-full h-full grid grid-cols-2">
              {arts.map((track, i) => (
                <FadeImg key={i} src={artSrc(track)} className="w-full h-full object-cover" />
              ))}
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center shadow-xl">
              <Play size={16} fill="currentColor" className="text-base translate-x-0.5" />
            </div>
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-white truncate">{mix.name}</p>
          <p className="text-xs text-muted">{plural(mix.tracks.length, 'track')} · {getMixTypeLabel(mix.type)}</p>
        </div>
      </motion.button>
      <button
        onClick={onSave}
        disabled={saving}
        title="Save as playlist"
        aria-label={`Save ${mixTitle(mix)} as a playlist`}
        className={`absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white/85 backdrop-blur transition-all hover:bg-black/80 hover:text-accent focus:opacity-100 ${saving ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      >
        {saving ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" /> : <ListPlus size={15} />}
      </button>
    </motion.div>
  )
}

function discoveryOnlineItem(item) {
  if (!item?.videoId || !item.title || !item.artist) return null
  return {
    provider: 'yt',
    id: item.videoId,
    videoId: item.videoId,
    title: item.title,
    artist: item.artist,
    artists: item.artists || [item.artist],
    album: item.album || null,
    duration: item.duration || null,
    thumbnail: item.thumbnail || null,
    source: 'youtube',
  }
}

function discoveryEmptyMessage(error) {
  if (!error) return 'Connect Last.fm or YouTube Music to build a personal discovery shelf.'
  if (/connect|sign in/i.test(error)) return error
  return 'Discovery could not be refreshed right now. Your last cached shelf remains available when one exists.'
}

function DiscoveryTrack({ track, onPlay, onRadio }) {
  const artwork = trackArtURL(track)
  return (
    <div className="group flex min-w-0 items-center gap-1 rounded-xl p-2 transition-colors hover:bg-white/[0.06]">
      <button type="button" onClick={() => onPlay(track)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-card">
          {artwork ? <FadeImg src={artwork} className="h-full w-full object-cover" /> : <Music size={17} className="m-4 text-muted" />}
        </div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-white">{track.title}</p><p className="truncate text-xs text-muted">{track.artist}</p></div>
      </button>
      {onRadio && <button type="button" aria-label={`Start radio for ${track.title}`} onClick={() => onRadio(track)} className="rounded-full p-2 text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100" title="Start radio"><Radio size={14} /></button>}
    </div>
  )
}

function DiscoveryPanel({ data, loading, error, onRefresh, onSave, onPlay, onRadio, onArtistRadio, onImportPlaylist, importingPlaylist, onOpenSettings }) {
  const tracks = Array.isArray(data?.tracks) ? data.tracks : []
  const playlists = Array.isArray(data?.playlists) ? data.playlists : []
  const artists = Array.isArray(data?.similarArtists) ? data.similarArtists : []
  const hasAccount = Boolean(data?.youtubeConnected || data?.lastfmConnected)
  const feature = tracks[0]
  const upNext = tracks.slice(1, 4)
  const quickPicks = tracks.slice(4, 10)
  const freshFinds = tracks.slice(10, 18)
  return (
    <div className="space-y-9">
      <section>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div><div className="flex items-center gap-2"><Sparkles size={14} className="text-accent" /><h2 className="text-xs font-display uppercase tracking-widest text-muted">Discovery</h2></div><p className="mt-1 text-sm text-muted">Useful Last.fm and YouTube Music recommendations that expand your horizon beyond the library.</p></div>
          <button onClick={onRefresh} disabled={loading} title="Refresh Discovery" aria-label="Refresh Discovery" className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/70 disabled:opacity-50"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Refresh</button>
        </div>
        {feature ? <>
          <div className="grid gap-5 rounded-2xl border border-white/5 bg-white/[0.025] p-5 @md:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.8fr)]">
            <div className="flex min-w-0 items-center gap-5"><div className="h-32 w-32 flex-shrink-0 overflow-hidden rounded-xl bg-card shadow-2xl shadow-black/30 @sm:h-44 @sm:w-44">{trackArtURL(feature) ? <FadeImg src={trackArtURL(feature)} className="h-full w-full object-cover" /> : <Music size={34} className="m-12 text-muted" />}</div><div className="min-w-0"><p className="text-[11px] font-display uppercase tracking-[0.28em] text-muted">{feature.source === 'youtube' ? 'For you · YouTube Music' : 'Fresh find · Last.fm similar'}</p><h3 className="mt-2 truncate text-2xl font-medium text-white @sm:text-3xl">{feature.title}</h3><p className="mt-1 truncate text-base text-muted">{feature.artist}</p><div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => onPlay(feature)} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-medium text-black hover:bg-white/85"><Play size={15} fill="currentColor" />Play</button><button type="button" onClick={() => onRadio(feature)} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 hover:border-white/30 hover:text-white"><Radio size={15} />Radio</button></div></div></div>
            <div className="border-t border-white/10 pt-4 @md:border-l @md:border-t-0 @md:pl-5 @md:pt-0"><p className="text-[11px] font-display uppercase tracking-[0.24em] text-muted">Up next for you</p><div className="mt-3 space-y-1">{upNext.map(track => <DiscoveryTrack key={track.id} track={track} onPlay={onPlay} onRadio={onRadio} />)}</div></div>
          </div>
          <div className="mt-4 flex justify-end"><button onClick={onSave} className="flex items-center gap-1.5 text-xs font-display uppercase tracking-wider text-accent hover:text-accent/70"><ListPlus size={13} />Save discovery</button></div>
        </> : loading ? <div className="rounded-xl border border-border bg-elevated px-4 py-8 text-center text-sm text-muted">Building your Discovery shelf…</div> : !hasAccount ? <div className="rounded-xl border border-border bg-elevated p-4"><ProviderConnections compact onOpenSettings={onOpenSettings} /></div> : <div className="rounded-xl border border-border bg-elevated px-4 py-8 text-center text-sm text-muted">{discoveryEmptyMessage(error)}</div>}
      </section>
      {quickPicks.length > 0 && <section><div className="mb-4 flex items-center gap-2"><Sparkles size={14} className="text-accent" /><h2 className="text-xs font-display uppercase tracking-widest text-muted">Quick Picks</h2></div><div className="grid gap-2 @md:grid-cols-2 @lg:grid-cols-3">{quickPicks.map(track => <DiscoveryTrack key={track.id} track={track} onPlay={onPlay} onRadio={onRadio} />)}</div></section>}
      {artists.length > 0 && <section><div className="mb-4 flex items-center gap-2"><User size={14} className="text-accent" /><h2 className="text-xs font-display uppercase tracking-widest text-muted">Artists For You</h2></div><div className="grid grid-cols-3 gap-4 @sm:grid-cols-4 @md:grid-cols-6 @lg:grid-cols-8">{artists.slice(0, 8).map(artist => <button key={artist.name} type="button" onClick={() => onArtistRadio(artist)} className="group min-w-0 text-center"><div className="mx-auto aspect-square w-full max-w-28 overflow-hidden rounded-full bg-card ring-1 ring-white/10 transition-transform group-hover:scale-105">{artist.image ? <FadeImg src={artist.image} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center bg-accent/20 text-2xl font-medium text-accent">{artist.name.charAt(0)}</div>}</div><p className="mt-2 truncate text-sm text-white">{artist.name}</p><p className="text-xs text-muted">Start artist radio</p></button>)}</div></section>}
      {freshFinds.length > 0 && <section><div className="mb-4 flex items-center gap-2"><Music size={14} className="text-accent" /><h2 className="text-xs font-display uppercase tracking-widest text-muted">Fresh Finds</h2></div><TrackList tracks={freshFinds} reduceMotion /></section>}
      {playlists.length > 0 && <section><div className="mb-4 flex items-center gap-2"><Youtube size={14} className="text-red-300" /><h2 className="text-xs font-display uppercase tracking-widest text-muted">YouTube Music Playlists</h2></div><div className="grid grid-cols-1 gap-3 @md:grid-cols-2">{playlists.map(playlist => <div key={playlist.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-elevated p-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-white">{playlist.title}</p><p className="truncate text-xs text-muted">{[playlist.author, playlist.trackCount].filter(Boolean).join(' · ') || 'YouTube Music playlist'}</p></div><div className="flex flex-shrink-0 items-center gap-1.5"><button onClick={() => onImportPlaylist(playlist)} disabled={importingPlaylist === playlist.id} className="rounded-lg border border-accent/40 bg-accent/15 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/25 disabled:opacity-50">{importingPlaylist === playlist.id ? 'Importing…' : 'Import'}</button><button onClick={() => api.openExternal(playlist.url)} title="Open in YouTube Music" className="rounded-lg p-1.5 text-muted hover:bg-card hover:text-white"><ExternalLink size={14} /></button></div></div>)}</div></section>}
    </div>
  )
}

function MixPanel({ tracks, size, generating, onSize, onGenerate, onPlay, onSave }) {
  return <div className="space-y-7">
    <section>
       <div className="mb-4 flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Radio size={14} className="text-accent" /><h2 className="text-xs font-display uppercase tracking-widest text-muted">Mix</h2></div><p className="mt-1 text-sm text-muted">A fresh provider-driven mix from your taste, built to go beyond your library.</p></div><div className="flex items-center gap-2"><div className="flex gap-1 rounded-lg bg-card p-1">{[24, 32, 40].map(value => <button key={value} type="button" onClick={() => onSize(value)} disabled={generating} className={`rounded-md px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${size === value ? 'bg-accent text-base' : 'text-muted hover:text-white'}`}>{value}</button>)}</div><button onClick={onGenerate} disabled={generating} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-base disabled:opacity-50"><RefreshCw size={14} className={generating ? 'animate-spin' : ''} />{generating ? 'Refreshing…' : 'Regenerate'}</button></div></div>
    </section>
    {tracks.length > 0 ? <section className="rounded-xl border border-border bg-elevated p-4"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium text-white">Your {tracks.length}-track mix</p><p className="mt-0.5 text-xs text-muted">Picked from Last.fm and YouTube Music recommendations.</p></div><div className="flex gap-2"><button onClick={() => onPlay(tracks)} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs text-black"><Play size={13} fill="currentColor" />Play mix</button><button onClick={onSave} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted hover:text-white"><ListPlus size={13} />Save</button></div></div><TrackList tracks={tracks} reduceMotion /></section> : <div className="rounded-xl border border-border bg-elevated px-4 py-10 text-center text-sm text-muted">Connect Last.fm or YouTube Music, then regenerate a mix.</div>}
  </div>
}

// Remounted per user, so one user's cached sections never show for another
// (and a late answer for the previous user can't land in the new one's cache).
export default function Home() {
  const { user } = useAppStore()
  return <HomeContent key={user?.id || 'guest'} user={user} />
}

function HomeContent({ user }) {
  const uidKey = user?.id || 'guest'
  // Kept across visits: coming back shows the last sections at once.
  const [recentTracks, setRecentTracks] = useCachedState(`home:recent:${uidKey}`, [])
  const [suggestions, setSuggestions] = useCachedState(`home:suggestions:${uidKey}`, [])
  const [history, setHistory] = useCachedState(`home:history:${uidKey}`, [])
  const [mixes, setMixes] = useCachedState(`home:mixes:${uidKey}`, [])
  const [discovery, setDiscovery] = useCachedState(`home:discovery:v2:${uidKey}`, null)
  const [mixLab, setMixLab] = useCachedState(`home:mix:v2:${uidKey}`, { size: 32, tracks: [] })
  // Sections appear together once everything is in (not mixes, then
  // suggestions, then recent), and "No tracks yet" only when it's true.
  const [loaded, setLoaded, wasCached] = useCachedState(`home:loaded:${uidKey}`, false)
  usePageReady(loaded || wasCached)
  const location = useLocation()
  const [tab, setTab] = useState(() => (location.state?.tab === 'history' ? 'history' : location.state?.tab === 'discovery' ? 'discovery' : location.state?.tab === 'mixlab' ? 'mixlab' : 'home'))
  const { playQueue } = usePlayerStore()
  const navigate = useNavigate()
  const menu = useContextMenu()
  // What's being saved as a playlist ('mix:<id>' or 'suggestions'), one at a time.
  const [saving, setSaving] = useState(null)
  const [discoveryLoading, setDiscoveryLoading] = useState(false)
  const [discoveryError, setDiscoveryError] = useState('')
  const [importingPlaylist, setImportingPlaylist] = useState(null)
  const [mixLabGenerating, setMixLabGenerating] = useState(false)
  const [radioLoading, setRadioLoading] = useState(false)
  const discoveryRequestRef = useRef(0)
  const saveList = async (key, name, tracks, description) => {
    if (saving) return
    setSaving(key)
    const playlist = await saveAsPlaylist(name, tracks, { userId: user?.id, description }).catch(() => null)
    setSaving(null)
    showToast(playlist ? `Saved "${name}" (${plural(new Set(tracks.map(t => t.id)).size, 'song')})` : 'Could not create playlist')
  }
  const saveMix = (mix) => saveList(`mix:${mix.id}`, `${mixTitle(mix)} - ${today()}`, mix.tracks, `Your ${mixTitle(mix)} from Home`)
  const saveSuggestions = () => saveList('suggestions', `Suggested for You - ${today()}`, suggestions, 'Suggested for you on Home')

  const mixSize = Number(mixLab?.size) || 32
  const setMixSize = (size) => setMixLab(prev => ({ ...(prev || {}), size, tracks: prev?.tracks || [] }))

  const generateMix = async () => {
    if (mixLabGenerating) return
    setMixLabGenerating(true)
    try {
      const refreshed = !discovery?.tracks?.length ? await loadDiscovery(true) : null
      const candidates = Array.isArray(refreshed?.tracks) ? refreshed.tracks : (Array.isArray(discovery?.tracks) ? discovery.tracks : [])
      let unique = candidates.filter((track, index, list) => track?.id && list.findIndex(item => item.id === track.id) === index)
      if (unique.length < mixSize) {
        const source = (refreshed || discovery || {}).similarArtists || []
        const artists = source.slice(0, 8).map(artist => artist.name).filter(Boolean)
        const extraResults = await Promise.all(artists.map(artist => api.onlineSearch(`${artist} similar music`, 'yt').catch(() => null)))
        const extraItems = extraResults.flatMap(result => Array.isArray(result?.results) ? result.results.slice(0, 8) : [])
        const saved = extraItems.length ? await api.onlineSave(extraItems).catch(() => []) : []
        unique = [...unique, ...(Array.isArray(saved) ? saved : [])].filter((track, index, list) => track?.id && list.findIndex(item => item.id === track.id) === index)
      }
      setMixLab({ size: mixSize, tracks: unique.slice(0, mixSize) })
    } finally {
      setMixLabGenerating(false)
    }
  }

  const startRadio = async (seed) => {
    if (!seed || radioLoading) return
    setRadioLoading(true)
    try {
      await openRadio(navigate, seed, user?.id)
    } finally {
      setRadioLoading(false)
    }
  }

  const loadDiscovery = async (force = false) => {
    if (!force && discovery?.updatedAt && Date.now() - discovery.updatedAt < 5 * 60 * 1000) return
    const requestId = ++discoveryRequestRef.current
    setDiscoveryLoading(true)
    setDiscoveryError('')
    try {
      const [lastfm, youtube] = await Promise.all([
        Promise.resolve(api.lastfmDiscovery()).catch(() => ({ error: 'Last.fm Discovery unavailable.' })),
        Promise.resolve(api.youtubeAccount()).catch(() => ({ error: 'YouTube Music account unavailable.' })),
      ])
      if (requestId !== discoveryRequestRef.current) return
      const youtubeItems = [...(youtube?.home || [])]
      const seenYoutube = new Set()
      const accountItems = youtubeItems.map(discoveryOnlineItem).filter(item => item && !seenYoutube.has(item.id) && seenYoutube.add(item.id))
      const lastfmTracks = [...(lastfm?.similarTracks || [])]
      const seenLastfm = new Set()
      const searches = lastfmTracks
        .filter(track => track?.title && track?.artist)
        .filter(track => {
          const key = `${track.title.toLowerCase()}|${track.artist.toLowerCase()}`
          if (seenLastfm.has(key)) return false
          seenLastfm.add(key)
          return true
        })
        .slice(0, 18)
        .map(track => Promise.resolve(api.onlineSearch(`${track.artist} ${track.title}`, 'yt')).catch(() => null))
      const searchResponses = await Promise.all(searches)
      const lastfmItems = searchResponses.map(response => response?.results?.[0]).filter(Boolean).map(item => ({ ...item, source: 'lastfm' }))
      const sourceById = new Map([...accountItems, ...lastfmItems].map(item => [`yt-${item.id || item.videoId}`, item.source || 'youtube']))
      const saved = await api.onlineSave([...accountItems, ...lastfmItems]).catch(() => null)
      const tracks = (Array.isArray(saved) ? saved.filter(Boolean) : []).map(track => ({ ...track, source: sourceById.get(track.id) || 'youtube' }))
      if (requestId !== discoveryRequestRef.current) return
      const youtubeConnected = !youtube?.error
      const lastfmConnected = !lastfm?.error
      const next = {
        updatedAt: Date.now(),
        tracks,
        playlists: Array.isArray(youtube?.playlists) ? youtube.playlists : [],
        similarArtists: Array.isArray(lastfm?.similarArtists) ? lastfm.similarArtists : [],
        youtubeConnected,
        lastfmConnected,
      }
      setDiscovery(next)
      if (!tracks.length && !youtubeConnected && !lastfmConnected) setDiscoveryError(lastfm?.error || youtube?.error || '')
      return next
    } finally {
      if (requestId === discoveryRequestRef.current) setDiscoveryLoading(false)
    }
  }

  const importYoutubePlaylist = async (playlist) => {
    if (!playlist?.id || importingPlaylist) return
    setImportingPlaylist(playlist.id)
    try {
      const detail = await api.youtubeAccountPlaylist(playlist.id)
      const items = (detail?.tracks || []).map(discoveryOnlineItem).filter(Boolean)
      const saved = items.length ? await api.onlineSave(items) : []
      if (!Array.isArray(saved) || !saved.length) {
        showToast(detail?.error || 'Could not import this YouTube Music playlist')
        return
      }
      const local = await saveAsPlaylist(playlist.title, saved, { userId: user?.id, description: `Imported from YouTube Music` }).catch(() => null)
      showToast(local ? `Imported "${playlist.title}"` : 'Could not create local playlist')
      if (local) window.dispatchEvent(new Event('lokal:playlists-changed'))
    } catch (error) {
      showToast(error?.message || 'Could not import this YouTube Music playlist')
    } finally {
      setImportingPlaylist(null)
    }
  }

  const openMixMenu = (event, mix) => menu.open(event, [
    { label: 'Play', icon: Play, onSelect: () => playQueue(mix.tracks, 0) },
    { label: 'Play next', icon: Clock, onSelect: () => playNextMany(mix.tracks) },
    { label: 'Add to queue', icon: ListEnd, onSelect: () => addToQueueMany(mix.tracks) },
    { label: 'Add to playlist…', icon: Plus, onSelect: () => addToPlaylistMany(mix.tracks) },
    { separator: true },
    { label: 'Save as playlist', icon: ListPlus, onSelect: () => saveMix(mix), disabled: !!saving },
  ])
  const openSuggestionMenu = (event, track, index) => menu.open(event, [
    { label: 'Play', icon: Play, onSelect: () => playQueue(suggestions, index) },
    { label: 'Play next', icon: Clock, onSelect: () => playNextMany([track]) },
    { label: 'Add to queue', icon: ListEnd, onSelect: () => addToQueueMany([track]) },
    { label: 'Add to playlist…', icon: Plus, onSelect: () => addToPlaylistMany([track]) },
    { label: 'Start radio', icon: Radio, onSelect: () => openRadio(navigate, track, user?.id) },
    { separator: true },
    track.album && { label: 'Go to album', icon: Disc3, onSelect: () => navigate('/albums', { state: { album: { title: track.album, album_artist: track.album_artist || track.artist } } }) },
    track.artist && { label: 'Go to artist', icon: User, onSelect: () => navigate(artistPath(track.album_artist || track.artist)) },
    { separator: true },
    { label: `Save all ${suggestions.length} as playlist`, icon: ListPlus, onSelect: saveSuggestions, disabled: !!saving },
  ].filter(Boolean))
  const nonGhost = (items) => (Array.isArray(items) ? items.filter(item => !String(item?.file_path || '').startsWith('ghost://')) : [])

  const load = () => {
    const uid = user?.id
    const soft = (promise) => Promise.resolve(promise).catch(() => null)
    // Applied in one go, so the sections don't pop in one after another.
    Promise.all([
      soft(api.getTracks({ sort: 'added_at DESC', limit: 10 })),
      soft(api.getSuggestions(uid)),
      soft(api.getHistory(uid, 30)),
      soft(api.getMixes(uid)),
    ]).then(([t, s, h, m]) => {
      // A failed request (or an { error } answer) keeps the last good section.
      if (Array.isArray(t)) setRecentTracks(nonGhost(t))
      if (Array.isArray(s)) setSuggestions(nonGhost(s))
      if (Array.isArray(h)) setHistory(h)
      if (Array.isArray(m)) setMixes(m.map(mix => ({ ...mix, tracks: nonGhost(mix.tracks) })).filter(mix => mix.tracks.length > 0))
      // "No tracks yet" needs the sections it's about to have really answered.
      if ([t, s, m].every(Array.isArray)) setLoaded(true)
    })
  }

  useEffect(() => { load() }, [user?.id])
  useEffect(() => {
    loadDiscovery()
    return () => { discoveryRequestRef.current += 1 }
  }, [user?.id])

  useEffect(() => {
    window.addEventListener('lokal:refresh', load)
    const refreshDiscovery = () => loadDiscovery(true)
    window.addEventListener('lokal:refresh', refreshDiscovery)
    return () => {
      window.removeEventListener('lokal:refresh', load)
      window.removeEventListener('lokal:refresh', refreshDiscovery)
    }
  }, [user?.id])

  const trackArt = (t) => t.artwork_path ? (api.isElectron ? `file://${t.artwork_path}` : api.artworkURL(t.id)) : null

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div className="p-6 space-y-7 w-full max-w-5xl mx-auto pb-10">
      <div>
        <h1 className="text-2xl font-display text-white">{greeting()}</h1>
        <p className="text-sm text-muted mt-1">Here's what's happening with your music</p>
      </div>


      <div className="flex gap-1 p-0.5 bg-elevated rounded-lg border border-border w-fit">
         {[['home', 'Home'], ['discovery', 'Discovery'], ['mixlab', 'Mix'], ['history', 'History']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-1.5 text-xs font-display uppercase tracking-wider rounded transition-colors ${tab === id ? 'bg-accent text-base' : 'text-muted hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Switching tab: the other one fades in once painted. */}
      <SectionSwap id={tab} className="space-y-7">
      {tab === 'history' ? (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <History size={14} className="text-muted" />
            <h2 className="text-xs font-display text-muted uppercase tracking-widest">Listen History</h2>
          </div>
          {history.length > 0
            ? <TrackList tracks={history} reduceMotion />
            : loaded && <p className="text-muted text-sm text-center py-12">No listen history yet.</p>
          }
        </section>
      ) : tab === 'discovery' ? (
        <DiscoveryPanel
          data={discovery}
          loading={discoveryLoading}
           error={discoveryError}
           onRefresh={() => loadDiscovery(true)}
           onPlay={(track) => playQueue([track], 0, { type: 'discovery', id: track.id, name: 'Discovery' })}
           onRadio={startRadio}
           onArtistRadio={(artist) => startRadio({ artist: artist.name })}
           onSave={() => saveList('discovery', `Discovery - ${today()}`, discovery?.tracks || [], 'Personal Discovery from Last.fm and YouTube Music')}
          onImportPlaylist={importYoutubePlaylist}
          importingPlaylist={importingPlaylist}
          onOpenSettings={(provider) => navigate('/settings', { state: { category: provider === 'youtube' ? 'library' : 'integrations' } })}
        />
      ) : tab === 'mixlab' ? (
        <MixPanel
          tracks={mixLab?.tracks || []}
          size={mixSize}
          generating={mixLabGenerating}
          onSize={setMixSize}
          onGenerate={generateMix}
          onPlay={(tracks) => playQueue(tracks, 0, { type: 'mix', name: 'Mix' })}
          onSave={() => saveList('mixlab', `Mix - ${today()}`, mixLab?.tracks || [], 'Provider-based Mix from Last.fm and YouTube Music')}
        />
      ) : (
        <>
          {mixes.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Radio size={14} className="text-accent" />
                <h2 className="text-xs font-display text-muted uppercase tracking-widest">Your Mixes</h2>
              </div>
              <div className="grid grid-cols-2 @md:grid-cols-3 gap-3">
                {mixes.slice(0, 6).map(mix => (
                  <MixCard key={mix.id} mix={mix} onClick={() => playQueue(mix.tracks, 0)} onSave={() => saveMix(mix)} saving={saving === `mix:${mix.id}`} onContextMenu={(event) => openMixMenu(event, mix)} />
                ))}
              </div>
            </section>
          )}

          {suggestions.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={14} className="text-accent" />
                <h2 className="text-xs font-display text-muted uppercase tracking-widest">Suggested for You</h2>
                <button onClick={saveSuggestions} disabled={!!saving} title={`Save all ${suggestions.length} suggestions as a playlist`}
                  className="ml-auto flex items-center gap-1.5 text-xs text-accent hover:text-accent/70 font-display uppercase tracking-wider transition-colors disabled:opacity-50">
                  {saving === 'suggestions' ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent" /> : <ListPlus size={13} />}
                  Save as playlist
                </button>
              </div>
              <div className="grid grid-cols-2 @md:grid-cols-4 gap-3">
                {suggestions.slice(0, 8).map((t, i) => (
                  <motion.button
                    key={t.id}
                    onDoubleClick={() => playQueue(suggestions, i)}
                    onContextMenu={(event) => openSuggestionMenu(event, t, i)}
                    className="flex items-center gap-3 p-3 bg-elevated rounded-xl border border-border hover:border-accent/30 transition-all group text-left"
                  >
                    <div className="w-10 h-10 rounded-lg bg-card overflow-hidden flex-shrink-0 flex items-center justify-center text-subtle">
                      {trackArt(t) ? <FadeImg src={trackArt(t)} className="w-full h-full object-cover" /> : <Music size={16} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white truncate">{t.title}</p>
                      <p className="text-xs text-muted truncate">{t.artist}</p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </section>
          )}

          {recentTracks.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-display text-muted uppercase tracking-widest">Recently Added</h2>
                <button onClick={() => playQueue(recentTracks, 0)} className="text-xs text-accent hover:text-accent/70 font-display uppercase tracking-wider transition-colors">
                  Play All
                </button>
              </div>
              <TrackList tracks={recentTracks} reduceMotion />
            </section>
          )}

          {loaded && !recentTracks.length && !mixes.length && !suggestions.length && (
            <div className="text-center py-24 text-muted">
              <Music size={48} className="mx-auto mb-4 opacity-20" />
              <p className="font-medium">No tracks yet</p>
              <p className="text-sm mt-1 opacity-60">Pick your music folder in Library.</p>
            </div>
          )}
        </>
      )}
      </SectionSwap>
      <ContextMenu menu={menu} />
    </div>
  )
}
