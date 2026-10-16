import React, { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, Heart, Mic2, PanelRight, Maximize2, ListMusic, Plus, Moon, X, Radio, Gem, Cast } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import { useShallow } from 'zustand/react/shallow'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useTranslation } from '../i18n'
import { navigateToTrackAlbum } from '../playbackContext'
import { isOnlineTrack } from '../onlineBrowse'
import Waveform from './Waveform'
import { useAppearanceFlag } from '../appearanceFlags'
import Modal from './Modal'
import { trackArtURL, isStreamed, streamLabel } from '../onlineTracks'
import SaveToLibraryButton from './SaveToLibraryButton'
import { TIERS, formatLabel, isSuspect, tierOf, losslessMenuItem } from '../quality'
import AudioOutputPicker from './AudioOutputPicker'
import MixingMark from './MixingMark'
import ContextMenu, { useContextMenu } from './ContextMenu'
import { openRadio } from '../radioActions'
import { useCastStore } from '../cast/castStore'
import MarqueeText from './MarqueeText'
import TrackArtistLinks from './TrackArtistLinks'
import { useVolumeWheel } from '../volumeWheel'

function fmt(s) { return `${Math.floor((s||0)/60)}:${Math.floor((s||0)%60).toString().padStart(2,'0')}` }

export default function PlayerBar() {
  const { t } = useTranslation()
  const glass = useAppearanceFlag('glass_player_bar')
  const showWaveform = useAppearanceFlag('player_waveform')
  const nav = useNavigate()
  const {
    currentTrack, isPlaying, isBuffering, progress, duration, volume, shuffle, repeat,
    showRightSidebar, showQueue, showLyricsPanel, sidePanelView, exclusiveSidePanels,
    togglePlay, next, prev, setProgress, setVolume, toggleShuffle, toggleRepeat,
    toggleLyricsButton, toggleRightSidebar, toggleFullscreen, toggleQueueButton,
    likedIds, setLiked, audioRef, cfAudioRef, activeAudioElement,
    sleepTimerMinutes, sleepTimerEndTime, setSleepTimer, cancelSleepTimer,
    toggleMiniPlayer,
  } = usePlayerStore(useShallow(({
    currentTrack, isPlaying, isBuffering, progress, duration, volume, shuffle, repeat,
    showRightSidebar, showQueue, showLyricsPanel, sidePanelView, exclusiveSidePanels,
    togglePlay, next, prev, setProgress, setVolume, toggleShuffle, toggleRepeat,
    toggleLyricsButton, toggleRightSidebar, toggleFullscreen, toggleQueueButton,
    likedIds, setLiked, audioRef, cfAudioRef, activeAudioElement,
    sleepTimerMinutes, sleepTimerEndTime, setSleepTimer, cancelSleepTimer,
    toggleMiniPlayer,
  }) => ({
    currentTrack, isPlaying, isBuffering, progress, duration, volume, shuffle, repeat,
    showRightSidebar, showQueue, showLyricsPanel, sidePanelView, exclusiveSidePanels,
    togglePlay, next, prev, setProgress, setVolume, toggleShuffle, toggleRepeat,
    toggleLyricsButton, toggleRightSidebar, toggleFullscreen, toggleQueueButton,
    likedIds, setLiked, audioRef, cfAudioRef, activeAudioElement,
    sleepTimerMinutes, sleepTimerEndTime, setSleepTimer, cancelSleepTimer,
    toggleMiniPlayer,
  })))
  const { user, openAddToPlaylist } = useAppStore()
  const [likeAnim, setLikeAnim] = useState(false)
  const [keepCommaArtists, setKeepCommaArtists] = useState([])
  const volumeWheelRef = useVolumeWheel(volume, setVolume)
  const scrubbing = useRef(false)
  const [localProg, setLocalProg] = useState(null)
  const [showSleepTimer, setShowSleepTimer] = useState(false)
  const [sleepTimerDisplay, setSleepTimerDisplay] = useState(null)
  const menu = useContextMenu()
  const display = localProg ?? progress
  const isLiked = currentTrack && likedIds.has(currentTrack.id)
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat

  useEffect(() => {
    if (!sleepTimerEndTime) {
      setSleepTimerDisplay(null)
      return
    }
    
    const updateDisplay = () => {
      const remaining = sleepTimerEndTime - Date.now()
      if (remaining <= 0) {
        setSleepTimerDisplay(null)
        return
      }
      const minutes = Math.floor(remaining / 60000)
      const seconds = Math.floor((remaining % 60000) / 1000)
      setSleepTimerDisplay(`${minutes}:${seconds.toString().padStart(2, '0')}`)
    }
    
    updateDisplay()
    const interval = setInterval(updateDisplay, 1000)
    return () => clearInterval(interval)
  }, [sleepTimerEndTime])

  useEffect(() => {
    return () => {
      if (sleepTimerEndTime && Date.now() >= sleepTimerEndTime) {
        cancelSleepTimer()
      }
    }
  }, [])

  useEffect(() => {
    api.getKeepCommaArtists().then(artists => {
      if (Array.isArray(artists)) {
        setKeepCommaArtists(artists)
      } else if (artists?.value) {
        try { setKeepCommaArtists(JSON.parse(artists.value)) } catch {}
      }
    }).catch(() => {})
  }, [])


  const handleScrub = useCallback((e) => {
    if (!duration) return
    const r = e.currentTarget.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration
    setLocalProg(t)
    // Through the store: it seeks the playing element, or the TV while casting.
    if (scrubbing.current) usePlayerStore.getState().setProgressWithAudioUpdate(t)
  }, [duration])

  const toggleLike = async () => {
    if (!currentTrack) return
    const r = await api.toggleLike(currentTrack.id, user?.id, currentTrack)
    const liked = typeof r === 'boolean' ? r : r?.liked ?? false
    setLiked(currentTrack.id, liked)
    if (liked) { setLikeAnim(true); setTimeout(() => setLikeAnim(false), 600) }
  }

  const artSrc = trackArtURL(currentTrack)

  // An online song (YouTube, SoundCloud): label, and a button to save it.
  const streamed = isStreamed(currentTrack)

  const hasAlbum = !!currentTrack?.album || (!!isOnlineTrack(currentTrack) && !!(currentTrack?.source_album_id || currentTrack?.sourceAlbumId || currentTrack?.albumId))
  const handleTitleClick = () => {
    if (!hasAlbum) return
    navigateToTrackAlbum(nav, currentTrack)
  }

  const openTrackMenu = (event) => {
    if (!currentTrack) return
    menu.open(event, [
      { label: 'Start radio', icon: Radio, onSelect: () => openRadio(nav, currentTrack, user?.id) },
      currentTrack.artist && { label: 'Start artist radio', icon: Radio, onSelect: () => openRadio(nav, { artist: currentTrack.artist, type: 'artist' }, user?.id) },
      losslessMenuItem(currentTrack, Gem),
    ].filter(Boolean))
  }

  // The playing song's audio quality, when it's been read (not for streams).
  // Casting: the device it plays on (the chip under the artist).
  const castActive = usePlayerStore(s => s.castActive)
  // Playing a Flow: the play button takes the Flow orb's colours (Home → Flow).
  const flowPlaying = usePlayerStore(s => s.playbackContext?.type === 'flow')
  const castStatusDevice = useCastStore(s => s.status?.device)
  const castDevice = castActive ? castStatusDevice : null
  const qualityTier = currentTrack && !streamed ? (isSuspect(currentTrack) ? 'suspect' : tierOf(currentTrack)) : 'unknown'
  const quality = qualityTier !== 'unknown' ? { info: TIERS[qualityTier], format: formatLabel(currentTrack) } : null

  return (
    <>
      {/* Glass (Settings > Appearance > Player Bar), like the downloads popup:
          a card floating over the bottom of the pages, which scroll on
          underneath it (App leaves --player-space for it). Off: the plain
          strip below the pages. */}
      <div data-player-bar className={glass
        ? 'absolute inset-x-3 bottom-3 z-30 h-20 rounded-2xl border border-white/10 flex items-center px-4 gap-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-lg backdrop-saturate-150'
        : 'h-20 border-t border-border flex items-center px-4 gap-4 flex-shrink-0 z-10'}
        style={glass ? { backgroundColor: 'rgba(var(--surface-rgb), 0.55)' } : { backgroundColor: 'rgba(var(--surface-rgb), 0.9)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center gap-3 w-[370px] min-w-0">
        <button onClick={toggleFullscreen} disabled={!currentTrack}
          className="relative w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-elevated hover:ring-2 ring-accent/30 transition-all disabled:cursor-default">
          {/* Not "wait": with the window minimized no animation runs, and a
              wait for an exit that never finishes left the old song's cover
              (and title) up for good while songs changed. Layers crossfade. */}
          <AnimatePresence initial={false}>
            {artSrc ? (
              <motion.img key={currentTrack?.id} src={artSrc}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-subtle text-xl">♪</div>
            )}
          </AnimatePresence>
        </button>

        <div className="min-w-0 flex-1">
          {/* The new song's title in at once (fading in), never waiting on the old one's way out. */}
            <motion.div key={currentTrack?.id||'none'} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
              <div className="flex items-center gap-2 min-w-0">
                <MarqueeText className="flex-1 min-w-0">
                  {hasAlbum ? (
                    <button
                      onClick={handleTitleClick}
                      onContextMenu={openTrackMenu}
                      title={`Go to album: ${currentTrack.album || t('Album · Online')}`}
                      className="text-sm font-medium text-text hover:text-accent hover:underline transition-colors text-left">
                      {currentTrack.title}
                    </button>
                  ) : (
                    <span onContextMenu={openTrackMenu} className="text-sm font-medium text-text">{currentTrack?.title || '—'}</span>
                  )}
                </MarqueeText>
                {!!currentTrack?.explicit && (
                  <span className="px-1.5 py-0.5 rounded border border-border bg-card text-[10px] font-display uppercase tracking-wide text-muted flex-shrink-0">
                    E
                  </span>
                )}
              </div>
              {currentTrack ? (
                <div className="min-w-0">
                  <MarqueeText className="text-xs text-muted">
                    <TrackArtistLinks track={currentTrack} nav={nav} keepCommaArtists={keepCommaArtists} onContextMenu={openTrackMenu}
                      linkClassName="text-xs text-muted hover:text-accent transition-colors text-left" />
                  </MarqueeText>
                  {castDevice && (
                    // Casting: where it plays; a click opens the Cast menu.
                    <button onClick={() => window.dispatchEvent(new Event('lokal:open-cast-menu'))}
                      title={`Playing on ${castDevice.name}`}
                      className="mt-1 flex max-w-full items-center gap-1 text-[9px] font-display uppercase tracking-wider text-accent hover:opacity-80">
                      <Cast size={10} className="flex-shrink-0" aria-hidden="true" />
                      <span className="truncate">Playing on {castDevice.name}</span>
                    </button>
                  )}
                  {streamed && !castDevice && (
                    <span title={`Streaming from ${streamLabel(currentTrack)}, not in your library`} className="mt-1 block truncate text-[9px] font-display uppercase tracking-wider text-accent">
                      {streamLabel(currentTrack)}
                    </span>
                  )}
                </div>
              ) : <p className="text-xs text-muted">{t("No track playing")}</p>}
              {quality && (
                // The Audio Quality page's pill (same colours), what it means on hover.
                <button onClick={() => nav('/quality', { state: { tier: qualityTier } })}
                  title={`${quality.info.label}: ${quality.info.desc}${quality.format ? ` (${quality.format})` : ''}${quality.info.hint ? `\n${quality.info.hint}` : ''}`}
                  aria-label={`Audio quality: ${quality.info.label}, ${quality.info.desc}`}
                  className={`mt-1 block rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase leading-[14px] tracking-wide transition-opacity hover:opacity-80 ${quality.info.className}`}>
                  {quality.info.label}
                </button>
              )}
            </motion.div>
        </div>

        {currentTrack && (
          <div className="relative flex-shrink-0">
            <motion.button onClick={toggleLike} whileTap={{ scale: 0.75 }}
              className={`w-5 h-5 flex items-center justify-center leading-none transition-colors ${isLiked ? 'text-accent' : 'text-text/90 hover:text-text'}`}>
              <Heart size={16} fill={isLiked ? 'currentColor' : 'none'} />
            </motion.button>
            <AnimatePresence>
              {likeAnim && (
                <motion.div initial={{ scale: 0.5, opacity: 1 }} animate={{ scale: 2.8, opacity: 0 }} exit={{}}
                  transition={{ duration: 0.5 }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <Heart size={16} className="text-accent" fill="currentColor" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        {currentTrack && (
          <button onClick={() => openAddToPlaylist(currentTrack)} title={t("Add to playlist")}
            className="flex-shrink-0 text-text/90 hover:text-accent transition-colors">
            <Plus size={14} />
          </button>
        )}
        {streamed && <SaveToLibraryButton key={currentTrack.id} track={currentTrack} className="text-text/90" />}
        </div>

        <div className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
        <div className="relative flex items-center gap-4">
          {/* Beside the buttons (not over the seek bar), without moving them. */}
          <MixingMark className="absolute left-full top-1/2 ml-4 -translate-y-1/2 whitespace-nowrap pointer-events-none" />
          <button onClick={toggleShuffle} className={`transition-colors ${shuffle ? 'text-accent' : 'text-text/90 hover:text-text'}`} title={shuffle ? t("Shuffle on") : t("Shuffle off")}><Shuffle size={15} /></button>
          <button onClick={prev} className="text-text/90 hover:text-text transition-colors" title={t("Previous")}><SkipBack size={18} fill="currentColor" /></button>
          <motion.button onClick={togglePlay} disabled={!currentTrack} whileTap={{ scale: 0.88 }}
            className={`w-9 h-9 rounded-full flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-40 ${flowPlaying ? 'flow-play' : 'bg-accent text-base'}`}>
            {isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="translate-x-0.5" />}
          </motion.button>
          <button onClick={next} className="text-text/90 hover:text-text transition-colors" title={t("Next")}><SkipForward size={18} fill="currentColor" /></button>
          <button onClick={toggleRepeat} className={`transition-colors ${repeat !== 'none' ? 'text-accent' : 'text-text/90 hover:text-text'}`} title={t(repeat === 'none' ? 'Repeat off' : repeat === 'one' ? 'Repeat one' : 'Repeat all')}><RepeatIcon size={15} /></button>
        </div>
        <div className="relative flex items-center gap-2 w-full max-w-md">
          <span className="text-xs text-muted w-8 text-right font-display">{fmt(display)}</span>
          <div className="flex-1 h-1 bg-elevated rounded-full cursor-pointer group relative overflow-hidden"
            onMouseMove={handleScrub}
            onMouseDown={e => { scrubbing.current = true; handleScrub(e) }}
            onMouseUp={() => { scrubbing.current = false; setLocalProg(null) }}
            onMouseLeave={() => { if (!scrubbing.current) setLocalProg(null) }}>
            <div className="h-full bg-accent rounded-full relative" style={{ width: `${duration ? (display/duration)*100 : 0}%` }}>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            {isBuffering && streamed && (
              <div role="progressbar" aria-label={t("Loading track")} className="absolute inset-0 overflow-hidden rounded-full bg-elevated">
                <div className="queue-loading-seekbar h-full w-1/3 rounded-full bg-accent" />
              </div>
            )}
          </div>
          <span className="text-xs text-muted w-8 font-display">{fmt(duration)}</span>
        </div>
        </div>

        <div className="flex items-center gap-2 w-[370px] min-w-0 justify-end">
          {currentTrack && showWaveform && (
            <div className="min-w-0 shrink basis-[120px] overflow-hidden">
              <Waveform isPlaying={isPlaying} className="w-full" />
            </div>
          )}
          {!castDevice && <AudioOutputPicker />}
          <button onClick={toggleLyricsButton} className={`transition-colors ${(exclusiveSidePanels ? (showRightSidebar && sidePanelView === 'lyrics') : showLyricsPanel) ? 'text-accent' : 'text-text/90 hover:text-accent'}`} title={t("Lyrics")}><Mic2 size={16} /></button>
          <button onClick={toggleQueueButton} className={`transition-colors ${(exclusiveSidePanels ? (showRightSidebar && sidePanelView === 'queue') : showQueue) ? 'text-accent' : 'text-text/90 hover:text-text'}`} title={t("Queue")}><ListMusic size={16} /></button>
          <button onClick={toggleRightSidebar} className={`transition-colors ${showRightSidebar ? 'text-accent' : 'text-text/90 hover:text-text'}`} title={t("Now Playing")}>< PanelRight size={16} /></button>
          <button onClick={toggleMiniPlayer} disabled={!currentTrack} className="text-text/90 hover:text-accent transition-colors disabled:opacity-30" title={t("Mini Player")}><Radio size={15} /></button>
          <button onClick={toggleFullscreen} disabled={!currentTrack} className="text-text/90 hover:text-text transition-colors disabled:opacity-30" title={t("Fullscreen")}><Maximize2 size={15} /></button>
          
          <div className="relative flex items-center justify-center">
            <button 
              onClick={() => setShowSleepTimer(!showSleepTimer)} 
              className={`flex items-center justify-center transition-colors ${sleepTimerEndTime ? 'text-accent' : 'text-text/90 hover:text-text'}`} 
              title={sleepTimerEndTime ? `${t("Sleep Timer")}: ${sleepTimerDisplay}` : t("Sleep Timer")}
            >
              <Moon size={16} />
            </button>
            {sleepTimerEndTime && (
              <span className="absolute -top-2 -right-3 text-[8px] text-accent font-mono bg-surface px-1 rounded-full">
                {sleepTimerDisplay}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-1.5 ml-1">
            <button onClick={() => setVolume(volume > 0 ? 0 : 0.8)} className="text-text/90 hover:text-text transition-colors">
              {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input ref={volumeWheelRef} type="range" min={0} max={1} step={0.01} value={volume}
              onChange={e => setVolume(parseFloat(e.target.value))}
              className="w-18 accent-accent cursor-pointer h-1" style={{ width: 72 }} />
          </div>
        </div>
      </div>

      <Modal open={showSleepTimer} onClose={() => setShowSleepTimer(false)} title={t("Sleep Timer")} width="max-w-xs">
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Music will stop after the selected time. Use this if you would like the app to stop while you are sleeping. 
          </p>
          
          <div className="grid grid-cols-2 gap-2">
            {[5, 10, 15, 30, 45, 60].map(mins => (
              <button
                key={mins}
                onClick={() => { setSleepTimer(mins); setShowSleepTimer(false) }}
                className={`py-2.5 px-3 rounded-lg text-sm font-medium transition-colors ${
                  sleepTimerMinutes === mins 
                    ? 'bg-accent text-base' 
                    : 'bg-card border border-border text-muted hover:text-white hover:border-accent/30'
                }`}
              >
                {mins} min
              </button>
            ))}
          </div>
          
          {sleepTimerEndTime && (
            <div className="pt-3 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-sm text-accent">Timer active: {sleepTimerDisplay}</span>
                <button 
                  onClick={() => { cancelSleepTimer(); setShowSleepTimer(false) }}
                  className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                >
                  <X size={12} /> Cancel
                </button>
              </div>
            </div>
          )}
          
          <button 
            onClick={() => setShowSleepTimer(false)}
            className="w-full py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </Modal>
      <ContextMenu menu={menu} />
    </>
  )
}
