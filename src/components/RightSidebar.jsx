import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, Music, Maximize2, Mic2, Disc3, Radio, Clapperboard, Gem, ImageOff, ImagePlay } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore, useAppStore } from '../store/player'
import { useShallow } from 'zustand/react/shallow'
import LyricsPanel from './LyricsPanel'
import { QueueContent } from './QueuePanel'
import ArtworkBackdrop, { useArtworkBackdropEnabled } from './ArtworkBackdrop'
import MotionCover, { loadMotionCover } from './MotionCover'
import { useMotionCoverOff } from '../motionCoverPrefs'
import MixCovers from './MixCovers'
import { useMusicVideo, useMusicVideoView } from '../musicVideo'
import { api, wordSyncEnabled } from '../api'
import { useTranslation } from '../i18n'
import {
  contextLabel,
  isContextNavigable,
  navigateToContext,
  navigateToTrackAlbum,
} from '../playbackContext'
import TrackArtistLinks from './TrackArtistLinks'
import { cacheLyrics, peekLyrics, hasLyricLines } from '../lyrics/lyricsCache'
import { isOnlineTrack } from '../onlineBrowse'
import { isStreamed, trackArtURL } from '../onlineTracks'

import ContextMenu, { useContextMenu } from './ContextMenu'
import { openRadio } from '../radioActions'
import LikeBurst from './LikeBurst'
import { showToast } from './Toaster'
import { losslessMenuItem } from '../quality'

// "Music" is a placeholder some files carry, not a genre.
const isPlaceholderGenre = genre => !String(genre || '').trim() || String(genre).trim().toLowerCase() === 'music'

function InfoRow({ label, value, onClick = null, title = null, fx = true }) {
  const { t } = useTranslation()
  if (!value) return null
  return (
    <div className={`flex items-start gap-3 py-1.5 border-b last:border-0 ${fx ? 'border-white/10' : 'border-border/30'}`}>
      <span className={`text-xs font-display uppercase tracking-wider w-20 flex-shrink-0 pt-0.5 ${fx ? 'text-white/45' : 'text-muted'}`}>{label}</span>
      {onClick ? (
        <button
          onClick={onClick}
          title={title || undefined}
          className="text-xs text-white/70 leading-relaxed break-all text-left hover:text-accent hover:underline transition-colors">
          {value}
        </button>
      ) : (
        <span className="text-xs text-white/70 leading-relaxed break-all">{value}</span>
      )}
    </div>
  )
}

/** "FLAC · 16-bit / 44.1 kHz" for a track whose source says so, else null. */
function streamQualityLabel(track) {
  if (!track?.codec) return null
  const parts = [String(track.codec).toUpperCase()]
  if (track.bit_depth && track.sample_rate) parts.push(`${track.bit_depth}-bit / ${Number(track.sample_rate) / 1000} kHz`)
  return parts.join(' · ')
}

export default function RightSidebar() {
  const { t } = useTranslation()
  const { user } = useAppStore()
  const {
    showRightSidebar, toggleRightSidebar, currentTrack, isPlaying, progress,
    toggleFullscreen, toggleLyricsFullscreen, playbackContext,
    sidePanelView, setSidePanelView, toggleQueueButton, exclusiveSidePanels, likedIds, setLiked,
  } = usePlayerStore(useShallow(({
    showRightSidebar, toggleRightSidebar, currentTrack, isPlaying, progress,
    toggleFullscreen, toggleLyricsFullscreen, playbackContext,
    sidePanelView, setSidePanelView, toggleQueueButton, exclusiveSidePanels, likedIds, setLiked,
  }) => ({
    showRightSidebar, toggleRightSidebar, currentTrack, isPlaying, progress,
    toggleFullscreen, toggleLyricsFullscreen, playbackContext,
    sidePanelView, setSidePanelView, toggleQueueButton, exclusiveSidePanels, likedIds, setLiked,
  })))
  // Back from the mini player: the Lyrics and Queue overlays start over.
  // The app was hidden meanwhile (App's <Activity>), where no animation runs,
  // so one that was sliding out (the view changed while hidden) would stay
  // stuck over the view picked. Shown again as they are, without sliding in.
  const showMiniPlayer = usePlayerStore(state => state.showMiniPlayer)
  const [wasMini, setWasMini] = useState(showMiniPlayer)
  const [reveal, setReveal] = useState(0)
  if (wasMini !== showMiniPlayer) {
    setWasMini(showMiniPlayer)
    if (!showMiniPlayer) setReveal(n => n + 1)
  }
  const nav = useNavigate()
  const menu = useContextMenu()
  const likeBusy = useRef(false)
  const burstTimer = useRef(null)
  const [burst, setBurst] = useState(null)
  useEffect(() => () => clearTimeout(burstTimer.current), [])
  // Your plays of the song (30 s or more, as recaps count them), streamed
  // songs too: read for each song, as the one in the player keeps the count
  // it had when it started. This play is counted once it ends.
  const [trackPlays, setTrackPlays] = useState({ id: null, plays: null })
  useEffect(() => {
    const id = currentTrack?.id
    if (!id) return undefined
    let current = true
    Promise.resolve(api.getTrackPlays?.(user?.id || 'guest', id))
      .then(result => { if (current && Number.isFinite(result?.plays)) setTrackPlays({ id, plays: result.plays }) })
      .catch(() => {})
    return () => { current = false }
  }, [currentTrack?.id, user?.id])
  const plays = trackPlays.id === currentTrack?.id && trackPlays.plays !== null ? trackPlays.plays : Number(currentTrack?.play_count) || 0
  // A streamed song rarely comes with a genre: looked up (and kept) for it.
  const [foundGenre, setFoundGenre] = useState({ id: null, genre: null })
  useEffect(() => {
    const id = currentTrack?.id
    if (!id || !isPlaceholderGenre(currentTrack.genre) || !isStreamed(currentTrack)) return undefined
    let current = true
    Promise.resolve(api.onlineGenre?.(id)).then(genre => { if (current && genre) setFoundGenre({ id, genre }) }).catch(() => {})
    return () => { current = false }
  }, [currentTrack?.id, currentTrack?.genre]) // eslint-disable-line react-hooks/exhaustive-deps
  // "Music" is a placeholder some files carry, not a genre: not shown.
  const genre = (!isPlaceholderGenre(currentTrack?.genre) && currentTrack.genre) || (foundGenre.id === currentTrack?.id ? foundGenre.genre : null)
  const canOpenContext = isContextNavigable(playbackContext)
  const wordSync = wordSyncEnabled()
  // Backend-persisted setting (Settings' Unsynced Lyrics Auto-Sync toggle
  // saves via api.saveSettings, never to localStorage) -- reading a
  // localStorage key here that's never written left this permanently false
  // regardless of the actual saved choice. RightSidebar stays mounted for
  // the whole session, so a mount-once fetch would go stale the same way
  // FullscreenPlayer/LyricsFullscreen's did -- refetch whenever the full Lyrics
  // overlay or compact lyrics card is opened so settings changes take effect.
  const [settings, setSettings] = useState({})
  // The cover's Lyrics button swaps only the lower metadata card; it must not
  // open the full-height Lyrics overlay controlled by sidePanelView.
  const [infoCardView, setInfoCardView] = useState('info')
  const autoSelectLyricsRef = useRef(null)
  useEffect(() => setInfoCardView('info'), [currentTrack?.id])
  // Guards against an in-flight getSettings() from an earlier call
  // resolving AFTER a later one (e.g. the Lyrics panel is reopened, or
  // 'lokal:settings-saved' fires again, while the first request is still
  // pending) and overwriting the newer settings with stale ones.
  const settingsSeqRef = useRef(0)
  useEffect(() => {
    if (sidePanelView !== 'lyrics' && infoCardView !== 'lyrics') return
    const loadSettings = () => {
      const seq = ++settingsSeqRef.current
      api.getSettings()
        .then(s => { if (seq === settingsSeqRef.current) setSettings(s || {}) })
        .catch(() => {})
    }
    loadSettings()
    // Covers the case where the sidebar is *already* open to Lyrics when the
    // user saves in Settings -- sidePanelView itself never changes then, so
    // the effect above wouldn't otherwise refire.
    window.addEventListener('lokal:settings-saved', loadSettings)
    return () => window.removeEventListener('lokal:settings-saved', loadSettings)
  }, [sidePanelView, infoCardView])
  const isAutoSynced = settings.unsynced_auto_sync === '1'

  // The cover's top-left corner shows a Lyrics button when the song has
  // lyrics: looked up the first time the pointer gets there (or already
  // known from the lyrics cache), never for every song that plays.
  const [lyricsLookup, setLyricsLookup] = useState({ trackId: null, has: false })
  const cachedLyrics = currentTrack?.id ? peekLyrics(currentTrack.id) : undefined
  const songHasLyrics = cachedLyrics !== undefined ? hasLyricLines(cachedLyrics) : lyricsLookup.trackId === currentTrack?.id && lyricsLookup.has
  const lookUpLyrics = useCallback((track = currentTrack, autoSelect = false) => {
    if (!track?.id) return Promise.resolve(null)
    if (autoSelect) autoSelectLyricsRef.current = track.id
    const cached = peekLyrics(track.id)
    if (cached !== undefined) {
      const has = hasLyricLines(cached)
      setLyricsLookup({ trackId: track.id, has })
      if ((autoSelect || autoSelectLyricsRef.current === track.id) && has && usePlayerStore.getState().currentTrack?.id === track.id) setInfoCardView('lyrics')
      if (autoSelectLyricsRef.current === track.id) autoSelectLyricsRef.current = null
      return Promise.resolve(cached)
    }
    if (lyricsLookup.trackId === track.id) return Promise.resolve(null)
    setLyricsLookup({ trackId: track.id, has: false })
    return Promise.resolve(api.getLyrics(track.id, track.title, track.artist, track.album, track.duration, track.file_path))
      .then(r => {
        const result = r && (r.lines?.length || r.instrumental) ? r : null
        cacheLyrics(track.id, result)
        const has = hasLyricLines(result)
        setLyricsLookup(known => known.trackId === track.id ? { trackId: track.id, has } : known)
        // Select the lyrics card only if this is still the track being played.
        if ((autoSelect || autoSelectLyricsRef.current === track.id) && has && usePlayerStore.getState().currentTrack?.id === track.id) setInfoCardView('lyrics')
        if (autoSelectLyricsRef.current === track.id) autoSelectLyricsRef.current = null
        return result
      })
      .catch(() => {
        if (autoSelectLyricsRef.current === track.id) autoSelectLyricsRef.current = null
        return null
      })
  }, [currentTrack, lyricsLookup.trackId])

  // Lyrics are the default lower card whenever the current track has them.
  // Look up on track changes so users do not need to reveal the cover button
  // and click it again for every song. Tracks without lyrics keep their details.
  useEffect(() => {
    if (currentTrack?.id) void lookUpLyrics(currentTrack, true)
  }, [currentTrack?.id, lookUpLyrics])

  // Comma-preserving artist names (e.g. "Tyler, The Creator") configured in
  // Settings -- without this, navigateToTrackArtist falls back to its
  // default empty list and mis-slugs/mis-splits any such artist here, even
  // though PlayerBar's own artist link handles it correctly.
  const [keepCommaArtists, setKeepCommaArtists] = useState([])
  useEffect(() => {
    api.getKeepCommaArtists().then(artists => {
      if (Array.isArray(artists)) {
        setKeepCommaArtists(artists)
      } else if (artists?.value) {
        try { setKeepCommaArtists(JSON.parse(artists.value)) } catch {}
      }
    }).catch(() => {})
    // RightSidebar stays mounted across normal route navigation, so a list
    // loaded once at mount would otherwise go stale until a remount/reload
    // if the user updates it in Settings mid-session.
    const onUpdate = (e) => { if (Array.isArray(e.detail)) setKeepCommaArtists(e.detail) }
    window.addEventListener('lokal:comma-artists-updated', onUpdate)
    return () => window.removeEventListener('lokal:comma-artists-updated', onUpdate)
  }, [])

  // Whichever of info/lyrics is showing beneath the Queue overlay. The
  // overlay fully covers this (opaque background, see below), and closing
  // The base content area always shows 'info' now -- Queue and Lyrics are
  // both overlays that slide up over it (see below) and slide back down to
  // reveal it, so there's nothing else the base itself needs to render.
  // This is only used for the Details/Lyrics/Queue pill highlight. Queue is
  // a tab here only when the panel is shared (exclusiveSidePanels); in the
  // other mode it opens its own panel next to this one, and "Details" stays
  // highlighted.
  const tab = sidePanelView === 'lyrics' ? 'lyrics' : exclusiveSidePanels && sidePanelView === 'queue' ? 'queue' : 'info'

  // Cosmetic case: when the panel is closed and Queue/Lyrics is clicked,
  // toggleQueueButton/toggleLyricsButton opens it straight to that
  // sidePanelView in the same state update -- both go from closed/info to
  // open/<view> together. Playing the overlay's usual slide-up animation
  // on top of the panel's own opening animation looks like two separate
  // motions stacked back to back. Detect exactly that transition (was
  // closed, is now open, and this overlay is what's showing) and skip
  // *just* the overlay's entrance for it -- switching to it from an
  // already-open panel is untouched and still slides up as before.
  const wasSidebarOpenRef = useRef(showRightSidebar)
  const openedFreshToQueue = !wasSidebarOpenRef.current && showRightSidebar && sidePanelView === 'queue'
  const openedFreshToLyrics = !wasSidebarOpenRef.current && showRightSidebar && sidePanelView === 'lyrics'
  useEffect(() => {
    wasSidebarOpenRef.current = showRightSidebar
  })

  // Colour background + full-bleed cover (default), or the classic dark panel.
  const fx = useArtworkBackdropEnabled()
  // A tall (9:16) canvas gets a taller hero area -- about 60% of the panel's
  // height -- instead of being cropped into the square cover.
  const [canvasOn, setCanvasOn] = useState(false)
  // A song with a moving cover (a Canvas or an animated album cover) gets a
  // button to turn it off for that song, here and in full screen
  // (motionCoverPrefs.js). Whether it has one is asked even while it's off,
  // so the button stays to turn it back on.
  const [coverOff, setCoverOff] = useMotionCoverOff(currentTrack)
  const [coverClip, setCoverClip] = useState({ id: null, clip: null })
  useEffect(() => {
    const id = currentTrack?.id
    if (!id) return undefined
    let current = true
    loadMotionCover(id).then(clip => { if (current) setCoverClip({ id, clip: clip?.src ? clip : null }) })
    return () => { current = false }
  }, [currentTrack?.id])
  const clipNow = coverClip.id === currentTrack?.id ? coverClip.clip : null
  // AutoMix turns the cover over into the next song's (when it's a still one).
  // The official music video, once found and checked (musicVideo.js).
  const { video: musicVideo } = useMusicVideo(currentTrack)
  const showMusicVideo = useMusicVideoView(s => s.show)
  const clipName = clipNow && (clipNow.tall || clipNow.source === 'spotify') ? 'Canvas' : 'Moving Cover'
  const infoRef = useRef(null)
  const [infoHeight, setInfoHeight] = useState(0)
  useEffect(() => {
    const el = infoRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([entry]) => setInfoHeight(Math.round(entry.contentRect.height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [showRightSidebar])
  const canvasHero = canvasOn && infoHeight > 0
  const heroHeight = canvasHero ? Math.max(300, Math.round(infoHeight * 0.6)) : 300

  const artSrc = trackArtURL(currentTrack)

  const doubleClickLike = async event => {
    if (!currentTrack || likeBusy.current || event.target.closest?.('button, a, input, [role="slider"]')) return
    likeBusy.current = true
    const liked = likedIds.has(currentTrack.id)
    setBurst({ id: Date.now(), trackId: currentTrack.id, kind: liked ? 'unlike' : 'like' })
    clearTimeout(burstTimer.current)
    burstTimer.current = setTimeout(() => setBurst(null), 1200)
    try {
      const result = await api.toggleLike(currentTrack.id, user?.id, currentTrack)
      if (result?.error) throw new Error(result.error)
      if (useAppStore.getState().user?.id === user?.id) setLiked(currentTrack.id, typeof result === 'boolean' ? result : !!result?.liked)
    } catch (error) { setBurst(null); showToast(error.message || 'Could not update this song’s like.') } finally { likeBusy.current = false }
  }

  const openTrackMenu = (event) => {
    if (!currentTrack) return
    menu.open(event, [
      { label: 'Start radio', icon: Radio, onSelect: () => openRadio(nav, currentTrack, user?.id) },
      currentTrack.artist && { label: 'Start artist radio', icon: Radio, onSelect: () => openRadio(nav, { artist: currentTrack.artist, type: 'artist' }, user?.id) },
      losslessMenuItem(currentTrack, Gem),
    ].filter(Boolean))
  }

  // No backdrop blur on these (nor on the panel): the colour behind them is
  // already a blurred image, and blur filters nested in this panel made
  // Chromium flash dark bands over them whenever anything repainted (hovering
  // a list in the page, a playing canvas).

  const contextBlock = currentTrack && playbackContext?.name ? (
    <div className="min-w-0">
      <p className={`text-[10px] font-display uppercase tracking-[0.22em] ${fx ? 'text-white/50' : 'text-muted'}`}>
        {contextLabel(playbackContext)}
      </p>
      {canOpenContext ? (
        <button
          onClick={() => navigateToContext(nav, playbackContext, currentTrack?.id)}
          title={`Go to ${playbackContext.name}`}
          className={`mt-0.5 block max-w-full truncate text-xs hover:underline text-left ${fx ? 'text-white/85 hover:text-white' : 'text-accent'}`}>
          {playbackContext.name}
        </button>
      ) : (
        <p className="mt-0.5 truncate text-xs text-white/70">{playbackContext.name}</p>
      )}
    </div>
  ) : null
  const hasAlbumLink = !!currentTrack?.album || (isStreamed(currentTrack) && !!(currentTrack?.source_album_id || currentTrack?.sourceAlbumId || currentTrack?.albumId))

  return (
    <>
      {showRightSidebar && (
        // No AnimatePresence wrapping this: entering still animates fine
        // via initial->animate (that doesn't need AnimatePresence at all),
        // but closing has no exit animation to wait on -- React unmounts
        // this the instant showRightSidebar goes false, in the same
        // commit, so there is no animation-library timing to depend on
        // for "is the close actually instant" the way there would be with
        // an exit={{...}} + duration:0 override. This is guaranteed by
        // ordinary React unmount semantics, not by trusting Framer
        // Motion's internal exit-completion timing, which isn't something
        // I can verify without a live browser.
        <motion.aside
          initial={{ width: 0 }}
          animate={{ width: 300 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          aria-label={t("Now Playing")}
          className="overflow-hidden flex-shrink-0"
          style={{ minWidth: 300 }}
        >
          {/* Fixed width, slides via transform instead of the width above --
              keeping backdrop-filter/background off the width-animating
              element avoids the Chromium rendering glitch (blur resampling
              a shape that's actively changing) that read as a black-box
              flash. This element's own width never changes; sliding is
              purely x, and closing is instant along with the parent. */}
          <motion.div
            initial={{ x: 300 }}
            animate={{ x: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="h-full flex flex-col border-l border-border"
            style={{ width: 300, backgroundColor: 'rgba(var(--surface-rgb), 0.85)' }}
          >
          <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0 border-b border-border">
            <div className="flex gap-0.5 p-0.5 bg-card rounded-lg border border-border/50">
              {[['info', 'Details'], ['lyrics', 'Lyrics'], ['queue', 'Queue']].map(([id, label]) => (
                <button key={id} onClick={() => (id === 'queue' ? (tab === 'queue' ? null : toggleQueueButton()) : setSidePanelView(id))} aria-pressed={tab === id} className={`px-3 py-1 text-xs font-display uppercase tracking-wider rounded transition-colors ${tab === id ? 'bg-accent text-base' : 'text-muted hover:text-white'}`}>
                  {t(label)}
                </button>
              ))}
            </div>
            <button onClick={toggleRightSidebar} aria-label={t("Close the side panel")} className="text-muted hover:text-white transition-colors ml-2">
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Fixed-size content area: only what's INSIDE this ever changes
              when switching info/lyrics/queue -- the outer panel's width
              never moves, so there's no brief "adds space" moment and no
              second panel ever exists to overlap with. */}
          <div className="flex-1 overflow-hidden relative min-h-0">
            {/* The hidden Info/Lyrics pane is inert: not focusable or
                reachable by assistive tech while the other tab covers it. */}
            <div ref={infoRef} className="absolute inset-0 flex flex-col" inert={sidePanelView !== 'info'}>
              {/* Apple Music-style: the cover runs edge to edge and dissolves
                  into colours taken from it; a moving cover plays over the
                  still one when there is one. */}
              {fx && <ArtworkBackdrop trackId={currentTrack?.id} seam={artSrc ? heroHeight : 0} />}
              <div className={`relative flex-1 overflow-y-auto ${fx ? '' : 'p-4'} pb-[calc(var(--player-space,0px)+1rem)]`}>
                <motion.div
                  onDoubleClick={doubleClickLike}
                  title={t("Double-click to like or unlike this song")}
                  className={fx ? 'relative w-full overflow-hidden' : 'relative w-full rounded-xl overflow-hidden bg-card border border-border/50'}
                  style={{
                    // Square cover normally; a tall canvas grows it to ~60% of the panel.
                    height: fx ? heroHeight : (canvasHero ? heroHeight - 32 : 268),
                    transition: 'height 420ms cubic-bezier(0.4, 0, 0.2, 1)',
                    ...(fx && artSrc ? {
                      WebkitMaskImage: `linear-gradient(to bottom, black ${canvasHero ? 72 : 55}%, transparent 100%)`,
                      maskImage: `linear-gradient(to bottom, black ${canvasHero ? 72 : 55}%, transparent 100%)`,
                    } : null),
                  }}
                >
                  {/* Song to song: AutoMix's cloudy dissolve, else a short fade (MixCovers). */}
                  {artSrc ? (
                    <MixCovers track={currentTrack} render={(track, { top }) => (
                      <>
                        <img src={trackArtURL(track)} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        <MotionCover trackId={track?.id} only="square" off={coverOff} />
                        <MotionCover trackId={track?.id} only="tall" onActive={top ? setCanvasOn : undefined} off={coverOff} />
                      </>
                    )} />
                  ) : (
                    <div className={`absolute inset-0 flex items-center justify-center ${fx ? 'text-white/25' : 'text-subtle'}`}><Music size={52} /></div>
                  )}
                  {burst && burst.trackId === currentTrack?.id && <LikeBurst key={burst.id} kind={burst.kind} />}
                  {currentTrack && (
                    <div className="group/lyrics absolute left-0 top-0 z-10 h-1/3 w-1/2 p-2" onMouseEnter={() => lookUpLyrics()} onDoubleClick={e => e.stopPropagation()}>
                      {songHasLyrics && (
                        <button
                          type="button"
                          onClick={() => setInfoCardView(view => view === 'lyrics' ? 'info' : 'lyrics')}
                          aria-label={t(infoCardView === 'lyrics' ? 'Show details' : 'Show lyrics')}
                          aria-pressed={infoCardView === 'lyrics'}
                          title={t(infoCardView === 'lyrics' ? 'Show details' : 'Show lyrics')}
                          className={`flex h-8 w-8 items-center justify-center rounded-full opacity-0 backdrop-blur-sm transition-opacity focus-visible:opacity-100 group-hover/lyrics:opacity-100 ${infoCardView === 'lyrics' ? 'bg-white/85 text-black hover:bg-white' : 'bg-black/55 text-white hover:bg-black/70'}`}>
                          <Mic2 size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </motion.div>

                <div className={fx ? 'relative -mt-16 px-4 pb-4 space-y-4' : 'mt-4 space-y-4'}>
                  {!fx && contextBlock}

                  {/* In at once, fading: never waiting on the old title's way out (see PlayerBar). */}
                    <motion.div key={currentTrack?.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                      {currentTrack?.album || (isOnlineTrack(currentTrack) && (currentTrack?.source_album_id || currentTrack?.sourceAlbumId || currentTrack?.albumId)) ? (
                        <button
                          onClick={() => navigateToTrackAlbum(nav, currentTrack)}
                          onContextMenu={openTrackMenu}
                          title={currentTrack.album ? t('Go to album: {album}', { album: currentTrack.album }) : t('Go to album')}
                          className={fx ? 'text-lg font-semibold text-white leading-tight text-left hover:underline transition-colors max-w-full block drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)]' : 'font-display text-white text-sm leading-tight text-left hover:text-accent hover:underline transition-colors truncate max-w-full block'}>
                          {currentTrack?.title || 'Nothing playing'}
                        </button>
                      ) : (
                        <p onContextMenu={openTrackMenu} className={fx ? 'text-lg font-semibold text-white leading-tight drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)]' : 'font-display text-white text-sm leading-tight'}>{currentTrack?.title || 'Nothing playing'}</p>
                      )}
                      {currentTrack?.artist ? (
                        <TrackArtistLinks
                          track={currentTrack}
                          nav={nav}
                          keepCommaArtists={keepCommaArtists}
                          onContextMenu={openTrackMenu}
                          className={fx ? 'text-sm text-white/70 mt-0.5 text-left max-w-full block' : 'text-xs text-muted mt-0.5 text-left truncate max-w-full block'}
                          linkClassName={fx ? 'text-left hover:text-white hover:underline transition-colors' : 'text-left hover:text-accent hover:underline transition-colors'} />
                      ) : (
                        <p className={fx ? 'text-sm text-white/70 mt-0.5' : 'text-xs text-muted mt-0.5'}>{currentTrack?.artist}</p>
                      )}
                    </motion.div>

                  {fx && contextBlock}

                  {/* One bar of icons: Full Screen and Lyrics always; Music Video
                      and the canvas switch only when this song has one. */}
                  {currentTrack && (() => {
                    const btn = `flex flex-1 items-center justify-center py-2.5 transition-colors ${fx ? 'text-white/75 hover:bg-white/10 hover:text-white' : 'text-muted hover:bg-white/[0.04] hover:text-white'}`
                    const actions = [
                      { key: 'full', label: 'Full screen', icon: Disc3, onClick: toggleFullscreen },
                      { key: 'lyrics', label: 'Lyrics, full screen', icon: Mic2, onClick: toggleLyricsFullscreen },
                      musicVideo && { key: 'video', label: 'Music video', title: 'Play the official music video, in time with the song', icon: Clapperboard, onClick: showMusicVideo },
                      clipNow && {
                        key: 'clip', pressed: coverOff, icon: coverOff ? ImageOff : ImagePlay, onClick: () => setCoverOff(!coverOff),
                        label: coverOff ? `Show ${clipName}` : `Hide ${clipName}`,
                        title: coverOff ? `Show the ${clipName.toLowerCase()} for this song again` : `Hide the ${clipName.toLowerCase()}: the still cover for this song, here and in full screen`,
                      },
                    ].filter(Boolean)
                    return (
                      <div role="toolbar" aria-label={t("Song actions")} className={`flex overflow-hidden rounded-xl border ${fx ? 'divide-x divide-white/10 border-white/10 bg-white/[0.12]' : 'divide-x divide-border border-border bg-card'}`}>
                        {actions.map(({ key, label, title, icon: Icon, onClick, pressed }) => (
                          <button key={key} type="button" onClick={onClick} title={title || label} aria-label={label} aria-pressed={pressed}
                            className={`${btn} ${pressed ? (fx ? 'text-white/45' : 'text-muted/60') : ''}`}>
                            <Icon size={15} />
                          </button>
                        ))}
                      </div>
                    )
                  })()}

                  {currentTrack && (
                    infoCardView === 'lyrics' ? (
                      <div className={`relative h-[420px] min-h-[320px] overflow-hidden rounded-xl border ${fx ? 'border-white/10 bg-black/25' : 'border-border bg-card'}`}>
                        <LyricsPanel track={currentTrack} progress={progress} wordSync={wordSync} fullscreen={false} textScale={1.4} isAutoSynced={isAutoSynced} hideToolbar compact />
                      </div>
                    ) : (
                    <div className={fx ? 'bg-black/25 rounded-xl border border-white/10 px-4 py-1' : 'bg-card rounded-xl border border-border px-4 py-1'}>
                      <InfoRow
                        fx={fx}
                        label={t("Album")}
                        value={currentTrack.album || (hasAlbumLink ? t('Album · Online') : null)}
                        title={hasAlbumLink ? t('Go to album: {album}', { album: currentTrack.album || t('Album · Online') }) : null}
                        onClick={hasAlbumLink ? () => navigateToTrackAlbum(nav, currentTrack) : null}
                      />
                      {currentTrack.album_artist && currentTrack.album_artist !== currentTrack.artist && <InfoRow fx={fx} label={t("Alb. Artist")} value={currentTrack.album_artist} />}
                      <InfoRow fx={fx} label={t("Year")} value={currentTrack.year} />
                      <InfoRow fx={fx} label={t("Genre")} value={genre} />
                      <InfoRow fx={fx} label={t("Track #")} value={currentTrack.track_num ? `${currentTrack.track_num}` : null} />
                      <InfoRow fx={fx} label={t("Bitrate")} value={currentTrack.bitrate ? `${currentTrack.bitrate} kbps` : null} />
                      {/* A stream (an addon's) has no file to measure: what the source says of it. */}
                      {!currentTrack.bitrate && <InfoRow fx={fx} label={t("Quality")} value={streamQualityLabel(currentTrack)} />}
                      <InfoRow fx={fx} label={t("Plays")} value={plays > 0 ? plays.toLocaleString() : null} />
                    </div>
                    )
                  )}
                </div>
              </div>
            </div>

            {/* Lyrics: slides up over the base view above, slides back down
                to reveal it -- same overlay pattern as Queue below, so
                switching to/from Lyrics from an already-open panel animates
                identically, and opening fresh straight to Lyrics skips this
                entrance the same way Queue does (see openedFreshToLyrics). */}
            <AnimatePresence key={`lyrics-${reveal}`} initial={reveal === 0}>
              {sidePanelView === 'lyrics' && (
                <motion.div
                  key="lyrics-overlay"
                  initial={openedFreshToLyrics ? false : { y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                  className="absolute inset-0 flex flex-col"
                  style={{ backgroundColor: 'rgb(var(--surface-rgb))' }}
                >
                  <div className="flex-1 overflow-hidden min-h-0 pb-[var(--player-space,0px)]">
                    {currentTrack ? (
                      <LyricsPanel track={currentTrack} progress={progress} darkMode wordSync={wordSync} fullscreen={false} textScale={1.4} isAutoSynced={isAutoSynced} />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted text-xs">{t("No track playing")}</div>
                    )}
                  </div>
                  <div className="p-3 border-t border-border flex-shrink-0">
                    <button onClick={toggleLyricsFullscreen} className="w-full py-2 bg-card border border-border rounded-xl text-xs text-muted hover:text-white hover:border-accent/30 transition-all font-display uppercase tracking-wider flex items-center justify-center gap-1.5">
                      <Maximize2 size={11} /> {t('Expand Lyrics')}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Queue: slides up over the base view above, slides back down
                to reveal it -- never a second panel, never a width change. */}
            <AnimatePresence key={`queue-${reveal}`} initial={reveal === 0}>
              {exclusiveSidePanels && sidePanelView === 'queue' && (
                <motion.div
                  key="queue-overlay"
                  initial={openedFreshToQueue ? false : { y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                  className="absolute inset-0 flex flex-col"
                  style={{ backgroundColor: 'rgb(var(--surface-rgb))' }}
                >
                  <QueueContent onClose={toggleQueueButton} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          </motion.div>
        </motion.aside>
      )}
      <ContextMenu menu={menu} />
    </>
  )
}
