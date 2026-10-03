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
  }
}

function discoveryEmptyMessage(error) {
  if (!error) return 'Connect Last.fm or YouTube Music to build a personal discovery shelf.'
  if (/connect|sign in/i.test(error)) return error
  return 'Discovery could not be refreshed right now. Your last cached shelf remains available when one exists.'
}

function DiscoveryPanel({ data, loading, error, onRefresh, onSave, onImportPlaylist, importingPlaylist, onOpenSettings }) {
  const tracks = Array.isArray(data?.tracks) ? data.tracks : []
  const playlists = Array.isArray(data?.playlists) ? data.playlists : []
  const hasAccount = Boolean(data?.youtubeConnected || data?.lastfmConnected)
  return (
    <div className="space-y-7">
      <section>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-accent" />
              <h2 className="text-xs font-display text-muted uppercase tracking-widest">For You</h2>
            </div>
            <p className="text-sm text-muted mt-1">Last.fm taste and YouTube Music account signals, resolved into playable tracks.</p>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            title="Refresh Discovery"
            aria-label="Refresh Discovery"
            className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/70 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        {tracks.length > 0 ? (
          <>
            <div className="flex items-center justify-end mb-2">
              <button onClick={onSave} className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/70 font-display uppercase tracking-wider">
                <ListPlus size={13} /> Save as playlist
              </button>
            </div>
            <TrackList tracks={tracks} reduceMotion />
          </>
        ) : loading ? (
          <div className="rounded-xl border border-border bg-elevated px-4 py-8 text-center text-sm text-muted">Building your Discovery shelf…</div>
        ) : !hasAccount ? (
          <div className="rounded-xl border border-border bg-elevated p-4">
            <ProviderConnections compact onOpenSettings={onOpenSettings} />
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-elevated px-4 py-8 text-center text-sm text-muted">{discoveryEmptyMessage(error)}</div>
        )}
      </section>

      {playlists.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Youtube size={14} className="text-red-300" />
            <h2 className="text-xs font-display text-muted uppercase tracking-widest">Your YouTube Music Playlists</h2>
          </div>
          <div className="grid grid-cols-1 @md:grid-cols-2 gap-3">
            {playlists.map(playlist => (
              <div key={playlist.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-elevated p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{playlist.title}</p>
                  <p className="truncate text-xs text-muted">{[playlist.author, playlist.trackCount].filter(Boolean).join(' · ') || 'YouTube Music playlist'}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <button onClick={() => onImportPlaylist(playlist)} disabled={importingPlaylist === playlist.id} className="rounded-lg border border-accent/40 bg-accent/15 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/25 disabled:opacity-50">
                    {importingPlaylist === playlist.id ? 'Importing…' : 'Import'}
                  </button>
                  <button onClick={() => api.openExternal(playlist.url)} title="Open in YouTube Music" aria-label={`Open ${playlist.title} in YouTube Music`} className="rounded-lg p-1.5 text-muted hover:bg-card hover:text-white">
                    <ExternalLink size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function MixLabPanel({ candidates, seed, tracks, generating, radioLoading, onSelectSeed, onGenerate, onRadio, onSave }) {
  const artwork = (track) => track?.artwork_path
    ? (api.isElectron ? `file://${track.artwork_path}` : api.artworkURL(track.id))
    : track?.artwork_url || null

  return (
    <div className="space-y-7">
      <section>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Radio size={14} className="text-accent" />
              <h2 className="text-xs font-display text-muted uppercase tracking-widest">Mix Lab</h2>
            </div>
            <p className="text-sm text-muted mt-1">Shape a fresh mix from your library, listening history, and related tracks.</p>
          </div>
          <button onClick={onGenerate} disabled={generating || !seed} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-base transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-50">
            {generating ? 'Generating…' : 'Generate Mix'}
          </button>
        </div>

        {candidates.length > 0 ? (
          <div className="space-y-3 rounded-xl border border-border bg-elevated p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">Choose a starting point</p>
                <p className="mt-0.5 text-xs text-muted">Radio and Mix Lab use this seed to keep the queue coherent.</p>
              </div>
              <select value={seed?.id || candidates[0]?.id || ''} onChange={event => onSelectSeed(event.target.value)} className="max-w-[48%] rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-white outline-none focus:border-accent/50">
                {candidates.map(track => <option key={track.id} value={track.id}>{track.artist} — {track.title}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 @md:grid-cols-4 gap-2">
              {candidates.slice(0, 4).map(track => (
                <button key={track.id} onClick={() => onSelectSeed(track.id)} className={`flex items-center gap-2 rounded-lg border p-2 text-left transition-colors ${seed?.id === track.id ? 'border-accent/60 bg-accent/10' : 'border-border bg-card hover:border-accent/30'}`}>
                  <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded bg-elevated">
                    {artwork(track) && <img src={artwork(track)} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs text-white">{track.title}</p>
                    <p className="truncate text-[11px] text-muted">{track.artist}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-elevated px-4 py-8 text-center text-sm text-muted">Play or scan a few tracks first and Mix Lab will use them as seeds.</div>
        )}
      </section>

      {seed && (
        <section className="rounded-xl border border-border bg-elevated p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-sm font-medium text-white">{tracks.length ? 'Your generated mix' : `${seed.title} Radio`}</p>
              <p className="mt-0.5 text-xs text-muted">Seed: {seed.artist} — {seed.title}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => onRadio(seed)} disabled={radioLoading} className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25 disabled:opacity-50">
                <Radio size={13} />
                {radioLoading ? 'Starting…' : 'Start Radio'}
              </button>
              {tracks.length > 0 && <button onClick={onSave} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted hover:text-white"><ListPlus size={13} /> Save</button>}
            </div>
          </div>
          {tracks.length > 0 ? <TrackList tracks={tracks} reduceMotion /> : <p className="py-8 text-center text-sm text-muted">Generate the mix to see related tracks.</p>}
        </section>
      )}
    </div>
  )
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
  const [discovery, setDiscovery] = useCachedState(`home:discovery:${uidKey}`, null)
  const [mixLab, setMixLab] = useCachedState(`home:mixlab:${uidKey}`, { seedId: '', tracks: [] })
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

  const mixCandidates = [...suggestions, ...recentTracks, ...history]
    .filter(track => track?.id && track?.title && track?.artist)
    .filter((track, index, list) => list.findIndex(candidate => candidate.id === track.id) === index)
    .slice(0, 20)
  const mixSeed = mixCandidates.find(track => track.id === mixLab?.seedId) || mixCandidates[0] || null

  const selectMixSeed = (id) => setMixLab(prev => ({ ...(prev || {}), seedId: id, tracks: prev?.tracks || [] }))

  const generateMixLab = async () => {
    if (!mixSeed || mixLabGenerating) return
    setMixLabGenerating(true)
    try {
      const related = await api.getRelated(mixSeed.id, user?.id).catch(() => [])
      const list = (Array.isArray(related) ? related : [])
        .filter(track => track?.id && track.id !== mixSeed.id)
        .filter((track, index, all) => all.findIndex(candidate => candidate.id === track.id) === index)
        .slice(0, 24)
      setMixLab({ seedId: mixSeed.id, tracks: [mixSeed, ...list] })
    } finally {
      setMixLabGenerating(false)
    }
  }

  const startRadio = async (seed) => {
    if (!seed || radioLoading) return
    setRadioLoading(true)
    try {
      let related = await api.getRelated(seed.id, user?.id).catch(() => [])
      if (!Array.isArray(related) || !related.length) {
        const online = await api.onlineSearch(`${seed.artist} ${seed.title} radio`, 'yt').catch(() => null)
        const saved = online?.results?.length ? await api.onlineSave(online.results.slice(0, 20)).catch(() => []) : []
        related = Array.isArray(saved) ? saved : []
      }
      const queue = [seed, ...(Array.isArray(related) ? related : [])]
        .filter(track => track?.id)
        .filter((track, index, all) => all.findIndex(candidate => candidate.id === track.id) === index)
        .slice(0, 25)
      if (queue.length) playQueue(queue, 0, { type: 'radio', id: seed.id, name: `${seed.title} Radio` })
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
      const youtubeItems = [...(youtube?.liked || []), ...(youtube?.home || [])]
      const seenYoutube = new Set()
      const accountItems = youtubeItems.map(discoveryOnlineItem).filter(item => item && !seenYoutube.has(item.id) && seenYoutube.add(item.id))
      const lastfmTracks = [...(lastfm?.tracks || []), ...(lastfm?.recent || [])]
      const seenLastfm = new Set()
      const searches = lastfmTracks
        .filter(track => track?.title && track?.artist)
        .filter(track => {
          const key = `${track.title.toLowerCase()}|${track.artist.toLowerCase()}`
          if (seenLastfm.has(key)) return false
          seenLastfm.add(key)
          return true
        })
        .slice(0, 8)
        .map(track => Promise.resolve(api.onlineSearch(`${track.artist} ${track.title}`, 'yt')).catch(() => null))
      const searchResponses = await Promise.all(searches)
      const lastfmItems = searchResponses.map(response => response?.results?.[0]).filter(Boolean)
      const saved = await api.onlineSave([...accountItems, ...lastfmItems]).catch(() => null)
      const tracks = Array.isArray(saved) ? saved.filter(Boolean) : []
      if (requestId !== discoveryRequestRef.current) return
      const youtubeConnected = !youtube?.error
      const lastfmConnected = !lastfm?.error
      const next = {
        updatedAt: Date.now(),
        tracks,
        playlists: Array.isArray(youtube?.playlists) ? youtube.playlists : [],
        youtubeConnected,
        lastfmConnected,
      }
      setDiscovery(next)
      // Merge remote YouTube Music likes into the local liked collection
      // without toggling songs that are already liked locally. Local unlikes
      // continue to flow back through api.toggleLike when the user changes a
      // heart, so a refresh never silently re-likes an intentional choice.
      if (accountItems.length) {
        const likedTracks = await api.getLikedTracks(user?.id).catch(() => null)
        if (requestId !== discoveryRequestRef.current) return
        if (!Array.isArray(likedTracks)) return
        const localLiked = new Set(likedTracks.map(track => track.id))
        const remoteLikedIds = new Set((youtube?.liked || []).map(track => track.videoId).filter(videoId => videoId && !api.isYoutubeLocallyUnliked(videoId, user?.id)))
        const importKey = `lokal-youtube-imported-likes:${uidKey}`
        let importedIds = new Set()
        try { importedIds = new Set(JSON.parse(localStorage.getItem(importKey) || '[]').map(String)) } catch {}
        const remoteSaved = tracks.filter(track => {
          const id = String(track.file_path || '').match(/^ghost:\/\/youtube\/online\/([\w-]+)$/)?.[1]
          return id && remoteLikedIds.has(id) && !importedIds.has(id)
        })
        for (const track of remoteSaved.slice(0, 100)) {
          if (requestId !== discoveryRequestRef.current) return
          const id = String(track.file_path || '').match(/^ghost:\/\/youtube\/online\/([\w-]+)$/)?.[1]
          if (!localLiked.has(track.id)) {
            const result = await api.setLike(track.id, user?.id, true).catch(() => null)
            if (requestId !== discoveryRequestRef.current) return
            if (result?.liked) importedIds.add(id)
          } else if (id) importedIds.add(id)
        }
        if (requestId !== discoveryRequestRef.current) return
        try { localStorage.setItem(importKey, JSON.stringify([...importedIds].slice(-500))) } catch {}
      }
      if (!tracks.length && !youtubeConnected && !lastfmConnected) setDiscoveryError(lastfm?.error || youtube?.error || '')
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
         {[['home', 'Home'], ['discovery', 'Discovery'], ['mixlab', 'Mix Lab'], ['history', 'History']].map(([id, label]) => (
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
          onSave={() => saveList('discovery', `Discovery - ${today()}`, discovery?.tracks || [], 'Personal Discovery from Last.fm and YouTube Music')}
          onImportPlaylist={importYoutubePlaylist}
          importingPlaylist={importingPlaylist}
          onOpenSettings={(provider) => navigate('/settings', { state: { category: provider === 'youtube' ? 'library' : 'integrations' } })}
        />
      ) : tab === 'mixlab' ? (
        <MixLabPanel
          candidates={mixCandidates}
          seed={mixSeed}
          tracks={mixLab?.tracks || []}
          generating={mixLabGenerating}
          radioLoading={radioLoading}
          onSelectSeed={selectMixSeed}
          onGenerate={generateMixLab}
          onRadio={startRadio}
          onSave={() => saveList('mixlab', `Mix Lab - ${today()}`, mixLab?.tracks || [], `Generated from ${mixSeed?.artist || 'your listening'}`)}
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
