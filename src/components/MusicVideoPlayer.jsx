import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { X, Play, Pause, SkipBack, SkipForward, Mic2, Clapperboard } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { usePlayerStore } from '../store/player'
import LyricsPanel from './LyricsPanel'
import { api, wordSyncEnabled } from '../api'
import { trackArtURL } from '../onlineTracks'
import { useMusicVideo, useMusicVideoView, videoTimeFor, songTime } from '../musicVideo'

// Further apart than this and the video jumps to the song; closer, it catches
// up by playing a touch faster or slower, which you can't see.
const SEEK_DRIFT_S = 0.35
const NUDGE_DRIFT_S = 0.04
const IDLE_MS = 2600
const EASE = [0.32, 0.72, 0, 1]

function fmt(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/**
 * The music video, full window, Apple Music style: the cover gives way to the
 * video once it plays, controls fade when the mouse rests, and the synced
 * lyrics can sit over its side. The video is muted and follows the song, so
 * what you hear is still the song itself (lossless, EQ, crossfade...).
 */
export default function MusicVideoPlayer() {
  const { open, hide } = useMusicVideoView(useShallow(s => ({ open: s.open, hide: s.hide })))
  const { currentTrack, isPlaying, togglePlay, next, prev, progress, duration, setProgressWithAudioUpdate } = usePlayerStore(useShallow(s => ({
    currentTrack: s.currentTrack, isPlaying: s.isPlaying, togglePlay: s.togglePlay, next: s.next, prev: s.prev,
    progress: s.progress, duration: s.duration, setProgressWithAudioUpdate: s.setProgressWithAudioUpdate,
  })))
  const { video, loading } = useMusicVideo(currentTrack, open)
  const reduceMotion = useReducedMotion()
  const videoRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  // The song is at a moment the video doesn't have (past its end).
  const [outside, setOutside] = useState(false)
  const [showLyrics, setShowLyrics] = useState(false)
  const [autoSynced, setAutoSynced] = useState(false)
  const [idle, setIdle] = useState(false)
  const idleTimer = useRef(null)

  useEffect(() => { setReady(false); setFailed(false); setOutside(false) }, [video?.videoId, open])
  useEffect(() => { if (!currentTrack) hide() }, [currentTrack, hide])
  useEffect(() => {
    if (open) api.getSettings?.().then(s => setAutoSynced(s?.unsynced_auto_sync === '1')).catch(() => {})
  }, [open])

  const wake = useCallback(() => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS)
  }, [])
  useEffect(() => {
    if (!open) return undefined
    wake()
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      // Ours alone: the full screen player under this shouldn't close too.
      e.stopImmediatePropagation()
      e.preventDefault()
      hide()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(idleTimer.current) }
  }, [open, hide, wake])

  // Keep the picture on the song: same moment, same play/pause, paused while
  // the window is hidden.
  useEffect(() => {
    if (!open || !video) return undefined
    const tick = () => {
      const el = videoRef.current
      if (!el || el.readyState < 1) return
      const target = videoTimeFor(video.segments, songTime())
      const end = Number.isFinite(el.duration) ? el.duration : video.duration
      if (target == null || target < 0 || target > end - 0.05) {
        setOutside(true)
        if (!el.paused) el.pause()
        return
      }
      setOutside(false)
      const drift = el.currentTime - target
      if (Math.abs(drift) > SEEK_DRIFT_S) {
        el.currentTime = target
        el.playbackRate = 1
      } else {
        el.playbackRate = Math.abs(drift) > NUDGE_DRIFT_S ? 1 - Math.max(-0.06, Math.min(0.06, drift)) : 1
      }
      const shouldPlay = usePlayerStore.getState().isPlaying && !document.hidden
      if (shouldPlay && el.paused) el.play().catch(() => {})
      else if (!shouldPlay && !el.paused) el.pause()
    }
    tick()
    const id = setInterval(tick, 200)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [open, video])

  const art = trackArtURL(currentTrack)
  const showVideo = !!video && ready && !failed && !outside
  const status = loading ? 'loading'
    : !video ? 'none'
      : failed ? 'failed'
        : outside ? 'outside'
          : ready ? 'playing' : 'loading'
  const message = {
    none: 'No music video for this song',
    failed: "The music video couldn't be played",
    outside: null,
    loading: 'Loading music video',
  }[status]
  const chromeHidden = idle && showVideo
  const fade = { duration: reduceMotion ? 0 : 0.5, ease: EASE }
  const seek = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (duration > 0) setProgressWithAudioUpdate(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration)
  }

  return (
    <AnimatePresence>
      {open && currentTrack && (
        <motion.div
          key="music-video"
          role="dialog"
          aria-label={`Music video: ${currentTrack.title}`}
          initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.03 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: reduceMotion ? 1 : 1.03 }}
          transition={{ duration: reduceMotion ? 0 : 0.42, ease: EASE }}
          onMouseMove={wake}
          onClick={wake}
          className={`fixed inset-0 z-[60] bg-black overflow-hidden select-none ${chromeHidden ? 'cursor-none' : ''}`}
        >
          {/* The cover, blurred behind and sharp in the middle, until the video plays. */}
          {art && <img src={art} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-50" />}
          <div className="absolute inset-0 bg-black/40" />
          <AnimatePresence>
            {!showVideo && (
              <motion.div key={`cover-${currentTrack.id}`} className="absolute inset-0 flex flex-col items-center justify-center gap-7"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: reduceMotion ? 1 : 1.08 }} transition={fade}>
                <div className="relative w-[min(40vh,22rem)] aspect-square rounded-2xl overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.7)] border border-white/10 bg-white/5">
                  {art ? <img src={art} alt="" className="w-full h-full object-cover" /> : <span className="absolute inset-0 flex items-center justify-center text-white/10 text-7xl">♪</span>}
                  {status === 'loading' && (
                    <div className="absolute inset-0 overflow-hidden" aria-hidden>
                      <div className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/15 to-transparent animate-[mv-shimmer_1.6s_ease-in-out_infinite]" />
                    </div>
                  )}
                </div>
                {message && (
                  <div className="flex items-center gap-2.5 text-sm text-white/70" aria-live="polite">
                    {status === 'loading' && (
                      <span className="flex items-end gap-[3px] h-3.5" aria-hidden>
                        {[0, 1, 2].map(i => <span key={i} className="w-[3px] h-full rounded-full bg-white/70 origin-bottom animate-[mv-bar_0.9s_ease-in-out_infinite]" style={{ animationDelay: `${i * 0.15}s` }} />)}
                      </span>
                    )}
                    {message}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {video && !failed && (
            <motion.video
              key={video.videoId}
              ref={videoRef}
              src={video.src}
              muted
              playsInline
              preload="auto"
              disablePictureInPicture
              onPlaying={() => setReady(true)}
              onError={() => setFailed(true)}
              initial={{ opacity: 0 }}
              animate={{ opacity: showVideo ? 1 : 0 }}
              transition={fade}
              className="absolute inset-0 w-full h-full object-contain"
            />
          )}

          {/* Lyrics over the video's side, on a soft shade. */}
          <AnimatePresence>
            {showLyrics && (
              <motion.div key="lyrics"
                initial={{ opacity: 0, x: reduceMotion ? 0 : 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduceMotion ? 0 : 40 }}
                transition={{ duration: reduceMotion ? 0 : 0.4, ease: EASE }}
                className="absolute inset-y-0 right-0 w-[min(44rem,46vw)] pt-20 pb-28"
                style={{ background: 'linear-gradient(to left, rgba(0,0,0,0.72), rgba(0,0,0,0.45) 60%, transparent)' }}>
                <div className="h-full pl-16 pr-8">
                  <LyricsPanel track={currentTrack} progress={progress} fullscreen wordSync={wordSyncEnabled()} textScale={0.62} isAutoSynced={autoSynced} toolbarHidden={chromeHidden} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Controls: fade out while the mouse rests on a playing video. */}
          <motion.div className="absolute inset-0 pointer-events-none" animate={{ opacity: chromeHidden ? 0 : 1 }} transition={{ duration: 0.3 }}>
            <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/70 to-transparent" />
            <div className={`absolute top-5 left-5 right-5 flex items-center gap-3 ${chromeHidden ? '' : 'pointer-events-auto'}`}>
              <button onClick={hide} title="Close the music video (Esc)" aria-label="Close the music video"
                className="w-10 h-10 flex items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.08] backdrop-blur-md text-white/90 hover:bg-white/[0.16] hover:text-white transition-colors">
                <X size={18} />
              </button>
              <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-white/60"><Clapperboard size={13} /> Music Video</span>
            </div>
            <div className={`absolute left-8 right-8 bottom-7 flex flex-col gap-3 ${chromeHidden ? '' : 'pointer-events-auto'}`}>
              <div className="flex items-end justify-between gap-6">
                <div className="min-w-0">
                  <AnimatePresence mode="wait">
                    <motion.div key={currentTrack.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
                      <p className="text-xl font-semibold text-white truncate drop-shadow-[0_1px_8px_rgba(0,0,0,0.5)]">{currentTrack.title}</p>
                      <p className="text-sm text-white/70 truncate">{currentTrack.artist}</p>
                    </motion.div>
                  </AnimatePresence>
                </div>
                <div className="flex items-center gap-6 flex-shrink-0">
                  <button onClick={prev} title="Previous" aria-label="Previous" className="text-white/90 hover:text-white hover:scale-105 active:scale-95 transition-transform"><SkipBack size={26} fill="currentColor" /></button>
                  <button onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause' : 'Play'} className="text-white hover:scale-105 active:scale-95 transition-transform">
                    {isPlaying ? <Pause size={36} fill="currentColor" strokeWidth={0} /> : <Play size={36} fill="currentColor" strokeWidth={0} className="translate-x-0.5" />}
                  </button>
                  <button onClick={() => next(false)} title="Next" aria-label="Next" className="text-white/90 hover:text-white hover:scale-105 active:scale-95 transition-transform"><SkipForward size={26} fill="currentColor" /></button>
                </div>
                <div className="flex-1 flex justify-end min-w-0">
                  <button onClick={() => setShowLyrics(v => !v)} title={showLyrics ? 'Hide the lyrics' : 'Show the lyrics'} aria-label={showLyrics ? 'Hide the lyrics' : 'Show the lyrics'} aria-pressed={showLyrics}
                    className={`w-10 h-10 flex items-center justify-center rounded-full border backdrop-blur-md transition-colors ${showLyrics ? 'border-white/30 bg-white/20 text-white' : 'border-white/[0.14] bg-white/[0.08] text-white/90 hover:bg-white/[0.16]'}`}>
                    <Mic2 size={17} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[11px] tabular-nums text-white/60">
                <span className="w-10 text-right">{fmt(progress)}</span>
                <div onClick={seek} className="group relative flex-1 h-4 flex items-center cursor-pointer" role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(duration || 0)} aria-valuenow={Math.round(progress || 0)}>
                  <div className="relative w-full h-1 group-hover:h-1.5 transition-[height] rounded-full bg-white/20 overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-white/85 rounded-full" style={{ width: `${duration > 0 ? Math.min(100, (progress / duration) * 100) : 0}%` }} />
                  </div>
                </div>
                <span className="w-10">{fmt(duration)}</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
