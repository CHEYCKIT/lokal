import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, Music, Maximize2, Mic2, Disc3 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../store/player'
import LyricsPanel from './LyricsPanel'
import { QueueContent } from './QueuePanel'
import { api } from '../api'
import {
  contextLabel,
  isContextNavigable,
  navigateToContext,
  navigateToTrackAlbum,
} from '../playbackContext'
import { navigateToTrackArtist } from '../artistLink'

function InfoRow({ label, value, onClick = null, title = null }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-border/30 last:border-0">
      <span className="text-xs font-display text-muted uppercase tracking-wider w-20 flex-shrink-0 pt-0.5">{label}</span>
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

export default function RightSidebar() {
  const {
    showRightSidebar, toggleRightSidebar, currentTrack, isPlaying, progress,
    toggleFullscreen, toggleLyricsFullscreen, playbackContext,
    sidePanelView, setSidePanelView, toggleQueueButton, exclusiveSidePanels,
  } = usePlayerStore()
  const nav = useNavigate()
  const canOpenContext = isContextNavigable(playbackContext)
  const wordSync = localStorage.getItem('word-sync') === '1'
  // Backend-persisted setting (Settings' Unsynced Lyrics Auto-Sync toggle
  // saves via api.saveSettings, never to localStorage) -- reading a
  // localStorage key here that's never written left this permanently false
  // regardless of the actual saved choice. RightSidebar stays mounted for
  // the whole session, so a mount-once fetch would go stale the same way
  // FullscreenPlayer/LyricsFullscreen's did -- refetch whenever the Lyrics
  // overlay is opened so a change made in Settings takes effect right away.
  const [settings, setSettings] = useState({})
  useEffect(() => {
    if (sidePanelView !== 'lyrics') return
    api.getSettings().then(s => setSettings(s || {})).catch(() => {})
  }, [sidePanelView])
  const isAutoSynced = settings.unsynced_auto_sync === '1'

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
  // This is only used for the Details/Lyrics pill highlight: while the
  // Queue overlay is open, "Details" stays highlighted (matching what's
  // showing underneath it), same as before this was split into overlays.
  const tab = sidePanelView === 'lyrics' ? 'lyrics' : 'info'

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

  const artSrc = currentTrack?.artwork_path
    ? (api.isElectron ? `file://${currentTrack.artwork_path}` : api.artworkURL(currentTrack.id))
    : null

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
            style={{ width: 300, backgroundColor: 'rgba(var(--surface-rgb), 0.85)', backdropFilter: 'blur(12px)' }}
          >
          <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0 border-b border-border">
            <div className="flex gap-0.5 p-0.5 bg-card rounded-lg border border-border/50">
              {[['info', 'Details'], ['lyrics', 'Lyrics']].map(([id, label]) => (
                <button key={id} onClick={() => setSidePanelView(id)} className={`px-3 py-1 text-xs font-display uppercase tracking-wider rounded transition-colors ${tab === id ? 'bg-accent text-base' : 'text-muted hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={toggleRightSidebar} className="text-muted hover:text-white transition-colors ml-2">
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Fixed-size content area: only what's INSIDE this ever changes
              when switching info/lyrics/queue -- the outer panel's width
              never moves, so there's no brief "adds space" moment and no
              second panel ever exists to overlap with. */}
          <div className="flex-1 overflow-hidden relative min-h-0">
            <div className="absolute inset-0 flex flex-col" inert={sidePanelView !== 'info'}>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-card border border-border/50">
                    <AnimatePresence mode="wait">
                      {artSrc ? (
                        <motion.img key={currentTrack?.id} src={artSrc} initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-subtle"><Music size={52} /></div>
                      )}
                    </AnimatePresence>
                  </div>

                  {currentTrack && playbackContext?.name && (
                    <div className="min-w-0">
                      <p className="text-[10px] font-display uppercase tracking-[0.22em] text-muted">
                        {contextLabel(playbackContext)}
                      </p>
                      {canOpenContext ? (
                        <button
                          onClick={() => navigateToContext(nav, playbackContext, currentTrack?.id)}
                          title={`Go to ${playbackContext.name}`}
                          className="mt-0.5 block max-w-full truncate text-xs text-accent hover:underline text-left">
                          {playbackContext.name}
                        </button>
                      ) : (
                        <p className="mt-0.5 truncate text-xs text-white/70">{playbackContext.name}</p>
                      )}
                    </div>
                  )}

                  <AnimatePresence mode="wait">
                    <motion.div key={currentTrack?.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                      {currentTrack?.album ? (
                        <button
                          onClick={() => navigateToTrackAlbum(nav, currentTrack)}
                          title={`Go to album: ${currentTrack.album}`}
                          className="font-display text-white text-sm leading-tight text-left hover:text-accent hover:underline transition-colors truncate max-w-full block">
                          {currentTrack?.title || 'Nothing playing'}
                        </button>
                      ) : (
                        <p className="font-display text-white text-sm leading-tight">{currentTrack?.title || 'Nothing playing'}</p>
                      )}
                      {currentTrack?.artist ? (
                        <button
                          onClick={() => navigateToTrackArtist(nav, currentTrack, keepCommaArtists)}
                          title={`Go to artist: ${currentTrack.artist}`}
                          className="text-xs text-muted mt-0.5 text-left hover:text-accent hover:underline transition-colors truncate max-w-full block">
                          {currentTrack.artist}
                        </button>
                      ) : (
                        <p className="text-xs text-muted mt-0.5">{currentTrack?.artist}</p>
                      )}
                    </motion.div>
                  </AnimatePresence>

                  {currentTrack && (
                    <div className="flex gap-2">
                      <button onClick={toggleFullscreen} className="flex-1 py-2 bg-card border border-border rounded-xl text-xs text-muted hover:text-white hover:border-accent/30 transition-all font-display uppercase tracking-wider flex items-center justify-center gap-1.5">
                        <Disc3 size={11} /> Full Screen
                      </button>
                      <button onClick={toggleLyricsFullscreen} className="flex-1 py-2 bg-card border border-border rounded-xl text-xs text-muted hover:text-white hover:border-accent/30 transition-all font-display uppercase tracking-wider flex items-center justify-center gap-1.5">
                        <Mic2 size={11} /> Lyrics
                      </button>
                    </div>
                  )}

                  {currentTrack && (
                    <div className="bg-card rounded-xl border border-border px-4 py-1">
                      <InfoRow label="Artist" value={currentTrack.artist} />
                      <InfoRow
                        label="Album"
                        value={currentTrack.album}
                        title={currentTrack.album ? `Go to album: ${currentTrack.album}` : null}
                        onClick={currentTrack.album ? () => navigateToTrackAlbum(nav, currentTrack) : null}
                      />
                      {currentTrack.album_artist && currentTrack.album_artist !== currentTrack.artist && <InfoRow label="Alb. Artist" value={currentTrack.album_artist} />}
                      <InfoRow label="Year" value={currentTrack.year} />
                      <InfoRow label="Genre" value={currentTrack.genre} />
                      <InfoRow label="Track #" value={currentTrack.track_num ? `${currentTrack.track_num}` : null} />
                      <InfoRow label="Bitrate" value={currentTrack.bitrate ? `${currentTrack.bitrate} kbps` : null} />
                      <InfoRow label="Plays" value={currentTrack.play_count > 0 ? `${currentTrack.play_count}` : null} />
                    </div>
                  )}
                </div>
            </div>

            {/* Lyrics: slides up over the base view above, slides back down
                to reveal it -- same overlay pattern as Queue below, so
                switching to/from Lyrics from an already-open panel animates
                identically, and opening fresh straight to Lyrics skips this
                entrance the same way Queue does (see openedFreshToLyrics). */}
            <AnimatePresence>
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
                  <div className="flex-1 overflow-hidden min-h-0">
                    {currentTrack ? (
                      <LyricsPanel track={currentTrack} progress={progress} darkMode wordSync={wordSync} fullscreen={false} textScale={1.4} isAutoSynced={isAutoSynced} />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted text-xs">No track playing</div>
                    )}
                  </div>
                  <div className="p-3 border-t border-border flex-shrink-0">
                    <button onClick={toggleLyricsFullscreen} className="w-full py-2 bg-card border border-border rounded-xl text-xs text-muted hover:text-white hover:border-accent/30 transition-all font-display uppercase tracking-wider flex items-center justify-center gap-1.5">
                      <Maximize2 size={11} /> Expand Lyrics
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Queue: slides up over the base view above, slides back down
                to reveal it -- never a second panel, never a width change. */}
            <AnimatePresence>
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
    </>
  )
}
