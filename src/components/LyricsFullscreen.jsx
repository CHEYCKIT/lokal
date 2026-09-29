import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { X, Download, RotateCcw, Search, Disc3 } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import LyricsPanel from './LyricsPanel'
import SearchDrawer from './LyricsSearchDrawer'
import { api } from '../api'

// How the player and full-screen lyrics trade places (FullscreenPlayer uses it too).
export const FULLSCREEN_SWITCH = { duration: 0.42, ease: [0.22, 1, 0.36, 1] }

// Full-screen lyrics is a layout of the full-screen player, not an overlay of
// its own: FullscreenPlayer renders this over its (shared) backdrop, fades its
// own controls out as this fades in, and the cover shrinks into this header
// (layoutId "fullscreen-cover"), so switching reads as one view rearranging.
export default function LyricsFullscreen() {
  const { showLyricsFullscreen, toggleLyricsFullscreen, switchFullscreenView, currentTrack, progress } = usePlayerStore()
  const [refreshKey, setRefreshKey] = useState(0)
  const [showSearch, setShowSearch] = useState(false)
  const [searchSessions, setSearchSessions] = useState({})
  const [settings, setSettings] = useState({})
  const wordSync = localStorage.getItem('word-sync') !== '0'
  const reduceMotion = useReducedMotion()
  const away = reduceMotion ? 'none' : 'translateY(16px)'

  // LyricsFullscreen stays mounted as long as the full-screen player overlay
  // (it just hides its own JSX), so a settings fetch
  // tied to mount only ever ran once at startup -- toggling and saving
  // Unsynced Lyrics Auto-Sync later in Settings never updated this component,
  // and lyrics kept auto-syncing (or not) based on whatever was cached at
  // launch. Re-fetching whenever the overlay actually opens picks up the
  // current saved value.
  useEffect(() => {
    if (!showLyricsFullscreen) return
    api.getSettings().then(s => setSettings(s || {}))
  }, [showLyricsFullscreen])

  // This overlay can now be reached from inside FullscreenPlayer (its Expand
  // Lyrics button), where it renders on top of that other fullscreen view --
  // without its own Escape handler, FullscreenPlayer's Escape listener (bound
  // whenever *it's* open, regardless of what's stacked on top) was the only
  // one that fired, closing the player underneath instead of just this panel.
  useEffect(() => {
    // The search drawer sits on top of this overlay, so Escape closes it
    // first; otherwise showSearch stays true and the drawer reappears the
    // next time the overlay opens.
    const h = (e) => {
      if (e.key !== 'Escape') return
      if (showSearch) setShowSearch(false)
      else toggleLyricsFullscreen()
    }
    if (showLyricsFullscreen) document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [showLyricsFullscreen, toggleLyricsFullscreen, showSearch])

  const importLyrics = async () => {
    if (!currentTrack || !api.isElectron) return
    const fp = await api.openFile([{ name: 'Lyrics', extensions: ['lrc', 'txt', 'ttml', 'xml'] }])
    if (!fp) return
    const content = await api.readFileBinary(fp)
    if (!content) return
    const ext = fp.split('.').pop().toLowerCase()
    const type = ext === 'ttml' || ext === 'xml' ? 'ttml' : ext === 'lrc' ? 'lrc' : 'txt'
    await api.importLyrics(currentTrack.id, content, type)
    setRefreshKey(k => k + 1)
  }

  const artSrc = currentTrack?.artwork_path
    ? (api.isElectron ? `file://${currentTrack.artwork_path}` : api.artworkURL(currentTrack.id))
    : null

  const handleSearchRequest = () => {
    setShowSearch(true)
  }

  const activeSearchSession = currentTrack?.id
    ? searchSessions[currentTrack.id] || {
        title: currentTrack?.title || '',
        artist: currentTrack?.artist || '',
        results: [],
        loading: false,
        error: null,
      }
    : null

  const updateSearchSession = (patch) => {
    if (!currentTrack?.id) return
    setSearchSessions(prev => ({
      ...prev,
      [currentTrack.id]: {
        ...(prev[currentTrack.id] || {
          title: currentTrack?.title || '',
          artist: currentTrack?.artist || '',
          results: [],
          loading: false,
          error: null,
        }),
        ...patch,
      },
    }))
  }

  const isAutoSynced = settings.unsynced_auto_sync === '1'

  return (
    <AnimatePresence>
      {showLyricsFullscreen && (
        <motion.div
          initial={{ opacity: 0, transform: away }}
          animate={{ opacity: 1, transform: reduceMotion ? 'none' : 'translateY(0px)' }}
          exit={{ opacity: 0, transform: away }}
          transition={FULLSCREEN_SWITCH}
          className="absolute inset-0 z-20 flex flex-col overflow-hidden"
        >
          <div className="relative z-10 flex items-center justify-between px-8 py-5 flex-shrink-0">
            <div className="flex items-center gap-4">
              {artSrc && (
                // The player's big cover shrinks into this one (and back).
                <motion.img layoutId={reduceMotion ? undefined : 'fullscreen-cover'} src={artSrc} alt=""
                  transition={FULLSCREEN_SWITCH}
                  style={{ borderRadius: 8 }}
                  className="w-10 h-10 object-cover border border-white/10 flex-shrink-0" />
              )}
              <div>
                <p className="text-xs font-display text-white/30 uppercase tracking-widest">Lyrics</p>
                {currentTrack && <p className="text-sm text-white/60 mt-0.5 truncate max-w-sm">{currentTrack.title} — {currentTrack.artist}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {currentTrack && (
                <button onClick={() => switchFullscreenView('player')} title="Switch to the full-screen player"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/30 rounded-lg transition-colors">
                  <Disc3 size={12} /> Player
                </button>
              )}
              {currentTrack && (
                <button onClick={() => setShowSearch(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/30 rounded-lg transition-colors">
                  <Search size={12} /> Search
                </button>
              )}
              {api.isElectron && currentTrack && (
                <>
                  <button onClick={importLyrics}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/30 rounded-lg transition-colors">
                    <Download size={12} /> Import .lrc / .ttml
                  </button>
                  <button onClick={() => { api.clearLyricsCache(currentTrack.id); setRefreshKey(k => k + 1) }}
                    className="p-1.5 text-white/30 hover:text-white transition-colors rounded-lg hover:bg-white/8">
                    <RotateCcw size={14} />
                  </button>
                </>
              )}
              <button onClick={toggleLyricsFullscreen} className="p-1.5 text-white/30 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="relative z-10 flex-1 min-h-0">
            <LyricsPanel
              key={`${currentTrack?.id}-${refreshKey}`}
              track={currentTrack}
              progress={progress}
              darkMode
              fullscreen
              wordSync={wordSync}
              onSearchRequest={handleSearchRequest}
              textScale={1.15}
              isAutoSynced={isAutoSynced}
            />
          </div>

          <AnimatePresence>
            {showSearch && currentTrack && (
              <SearchDrawer
                track={currentTrack}
                session={activeSearchSession}
                onSessionChange={updateSearchSession}
                onClose={() => setShowSearch(false)}
                onSelect={(lyrics, type) => {
                  api.importLyrics(currentTrack.id, lyrics, type)
                  setRefreshKey(k => k + 1)
                  setShowSearch(false)
                }}
              />
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
