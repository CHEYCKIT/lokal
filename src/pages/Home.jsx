import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Music, Play, Clock, Sparkles, Radio, History, ListEnd, ListPlus, Plus, Disc3, User } from 'lucide-react'
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
  // Sections appear together once everything is in (not mixes, then
  // suggestions, then recent), and "No tracks yet" only when it's true.
  const [loaded, setLoaded, wasCached] = useCachedState(`home:loaded:${uidKey}`, false)
  usePageReady(loaded || wasCached)
  const location = useLocation()
  const [tab, setTab] = useState(() => (location.state?.tab === 'history' ? 'history' : 'home'))
  const { playQueue } = usePlayerStore()
  const navigate = useNavigate()
  const menu = useContextMenu()
  // What's being saved as a playlist ('mix:<id>' or 'suggestions'), one at a time.
  const [saving, setSaving] = useState(null)
  const saveList = async (key, name, tracks, description) => {
    if (saving) return
    setSaving(key)
    const playlist = await saveAsPlaylist(name, tracks, { userId: user?.id, description }).catch(() => null)
    setSaving(null)
    showToast(playlist ? `Saved "${name}" (${plural(new Set(tracks.map(t => t.id)).size, 'song')})` : 'Could not create playlist')
  }
  const saveMix = (mix) => saveList(`mix:${mix.id}`, `${mixTitle(mix)} - ${today()}`, mix.tracks, `Your ${mixTitle(mix)} from Home`)
  const saveSuggestions = () => saveList('suggestions', `Suggested for You - ${today()}`, suggestions, 'Suggested for you on Home')

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
    window.addEventListener('lokal:refresh', load)
    return () => window.removeEventListener('lokal:refresh', load)
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
        {[['home', 'Home'], ['history', 'History']].map(([id, label]) => (
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
            ? <TrackList tracks={history} showAlbum reduceMotion />
            : loaded && <p className="text-muted text-sm text-center py-12">No listen history yet.</p>
          }
        </section>
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
