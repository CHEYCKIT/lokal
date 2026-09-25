import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Maximize2 } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import LyricsPanel from './LyricsPanel'
import { api } from '../api'

// The actual lyrics view, with no opinion about how it's framed -- used both
// by the standalone panel below (independent mode) and, via RightSidebar's
// own 'lyrics' tab, embedded directly inside the merged panel, so the two
// visual presentations never drift out of sync with each other. Mirrors
// QueuePanel's QueueContent/QueuePanel split for the same reason.
export function LyricsContent({ onClose }) {
  const { currentTrack, progress, toggleLyricsFullscreen } = usePlayerStore()
  const wordSync = localStorage.getItem('word-sync') === '1'
  // Backend-persisted setting (Settings' Auto Translate/unsynced-auto-sync
  // toggle saves via api.saveSettings, never to localStorage), matching how
  // FullscreenPlayer/LyricsFullscreen already read it -- reading a
  // localStorage key here that's never written left this permanently false
  // regardless of the actual saved choice.
  const [settings, setSettings] = useState({})
  useEffect(() => {
    const loadSettings = () => api.getSettings().then(s => setSettings(s || {})).catch(() => {})
    loadSettings()
    // Refresh in place if the setting is changed in Settings while this
    // panel stays mounted, instead of only picking it up on next mount.
    window.addEventListener('lokal:settings-saved', loadSettings)
    return () => window.removeEventListener('lokal:settings-saved', loadSettings)
  }, [])
  const isAutoSynced = settings.unsynced_auto_sync === '1'

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <p className="text-xs font-display text-muted uppercase tracking-widest">Lyrics</p>
        {onClose && (
          <button onClick={onClose} className="text-muted hover:text-white transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

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
    </>
  )
}

// Standalone panel used only in independent mode -- merged mode never
// mounts this; its lyrics view is embedded directly inside RightSidebar's
// existing 'lyrics' tab instead, so the two panels can never overlap or
// momentarily add up their widths against each other. Mirrors QueuePanel
// exactly (same width, same animation) so the two standalone panels read
// as one consistent system.
export default function LyricsSidePanel() {
  const { showLyricsPanel, toggleLyricsPanel } = usePlayerStore()

  return (
    <>
      {showLyricsPanel && (
        <motion.aside
          initial={{ width: 0 }}
          animate={{ width: 320 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="overflow-hidden flex-shrink-0"
          style={{ minWidth: 320 }}
        >
          <motion.div
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="h-full flex flex-col border-l border-border"
            style={{ width: 320, backgroundColor: 'rgba(var(--surface-rgb), 0.85)', backdropFilter: 'blur(12px)' }}
          >
            <LyricsContent onClose={toggleLyricsPanel} />
          </motion.div>
        </motion.aside>
      )}
    </>
  )
}
