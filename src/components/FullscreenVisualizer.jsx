import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Expand, Gamepad2, Minimize, Minimize2, X } from 'lucide-react'
import { api, peekSettings } from '../api'
import { usePlayerStore } from '../store/player'
import MilkDrop from '../visualizers/MilkDrop'
import { loadMilkDropPresetNames, normalizeEnabledMilkDropPresets } from '../visualizers/milkDropPresets.mjs'
import { useTranslation } from '../i18n'

export default function FullscreenVisualizer() {
  const { t } = useTranslation()
  const open = usePlayerStore(state => state.showFullscreenVisualizer)
  const setOpen = usePlayerStore(state => state.setShowFullscreenVisualizer)
  const toggleMiniPlayer = usePlayerStore(state => state.toggleMiniPlayer)
  const currentTrack = usePlayerStore(state => state.currentTrack)
  const isPlaying = usePlayerStore(state => state.isPlaying)
  const [screenFull, setScreenFull] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement)
  const [idle, setIdle] = useState(false)
  const idleTimerRef = useRef(null)
  const overChromeRef = useRef(false)
  const [settings, setSettings] = useState(() => peekSettings() || {})
  const [availablePresets, setAvailablePresets] = useState([])
  const [currentPreset, setCurrentPreset] = useState('')
  const milkDropRef = useRef(null)
  const enabledPresets = useMemo(
    () => normalizeEnabledMilkDropPresets(settings.fullscreen_milkdrop_presets, availablePresets),
    [settings.fullscreen_milkdrop_presets, availablePresets],
  )
  const enabledKey = enabledPresets.join('|')

  useEffect(() => {
    const onFullscreenChange = () => setScreenFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    if (!open) {
      clearTimeout(idleTimerRef.current)
      setIdle(false)
      overChromeRef.current = false
      return undefined
    }
    const wake = () => {
      setIdle(false)
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => {
        if (!overChromeRef.current) setIdle(true)
      }, 3000)
    }
    const events = ['mousemove', 'mousedown', 'wheel', 'keydown', 'touchstart']
    events.forEach(type => window.addEventListener(type, wake, { passive: true }))
    wake()
    return () => {
      clearTimeout(idleTimerRef.current)
      events.forEach(type => window.removeEventListener(type, wake))
    }
  }, [open])

  const wakeChrome = () => {
    setIdle(false)
    clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      if (!overChromeRef.current) setIdle(true)
    }, 3000)
  }

  const enterMiniVisualizer = async () => {
    if (document.fullscreenElement && document.exitFullscreen) {
      try { await document.exitFullscreen() } catch {}
    }
    await toggleMiniPlayer()
    if (usePlayerStore.getState().showMiniPlayer) {
      usePlayerStore.setState({ showFullscreen: false, showFullscreenVisualizer: false, showMiniVisualizer: true })
    }
  }

  const toggleScreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }
  const cycle = delta => {
    if (enabledPresets.length < 2) return
    if (delta < 0) milkDropRef.current?.previousPreset()
    else milkDropRef.current?.nextPreset()
  }


  useEffect(() => {
    if (!open) return undefined
    let live = true
    loadMilkDropPresetNames()
      .then(names => { if (live) setAvailablePresets(names) })
      .catch(error => console.warn('[visualizer] Could not load MilkDrop preset names:', error))
    const refresh = () => {
      api.getSettings()
        .then(next => { if (live && next && !next.error) setSettings(next) })
        .catch(() => {})
    }
    refresh()
    window.addEventListener('lokal:settings-saved', refresh)
    return () => {
      live = false
      window.removeEventListener('lokal:settings-saved', refresh)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      } else if (event.key === 'ArrowRight' && enabledPresets.length > 1) {
        event.preventDefault()
        event.stopPropagation()
        cycle(1)
      } else if (event.key === 'ArrowLeft' && enabledPresets.length > 1) {
        event.preventDefault()
        event.stopPropagation()
        cycle(-1)
      }
    }
    // Capture Escape before FullscreenPlayer so closing this overlay doesn't
    // also close the regular full-screen player underneath it.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, enabledKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const chromeHidden = idle

  return (
    <div
      data-fullscreen-visualizer=""
      role="dialog"
      aria-modal="true"
      aria-label={t('Full-screen visualizer')}
      className={chromeHidden ? 'fixed inset-0 z-[70] overflow-hidden bg-[#030305] text-white cursor-none [&_*]:!cursor-none' : 'fixed inset-0 z-[70] overflow-hidden bg-[#030305] text-white'}
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(46,38,82,0.24),transparent_68%)]" />
      <MilkDrop
        ref={milkDropRef}
        className="absolute inset-0 h-full w-full"
        isPlaying={isPlaying}
        trackId={currentTrack?.id}
        presetNames={enabledPresets}
        onPresetChange={setCurrentPreset}
        showNextButton={false}
      />

      <header onMouseEnter={() => { overChromeRef.current = true; clearTimeout(idleTimerRef.current); setIdle(false) }} onMouseLeave={() => { overChromeRef.current = false; wakeChrome() }} className={"absolute inset-x-0 top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-4 px-4 py-4 sm:px-6 sm:py-5 transition-opacity duration-300 " + (chromeHidden ? "pointer-events-none opacity-0" : "opacity-100")}>
        <button
          type="button"
          onClick={() => setOpen(false)}
          title={t('Close full-screen visualizer')}
          aria-label={t('Close full-screen visualizer')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white/75 backdrop-blur-md transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X size={17} />
        </button>

        <div className="min-w-0 max-w-[min(52vw,48rem)] pt-1 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-display uppercase tracking-[0.24em] text-white/65">
            <Gamepad2 size={15} />
            <span>{t('Full-screen visualizer')}</span>
          </div>
          <p className="mt-1 truncate text-sm font-medium text-white/90">{currentTrack?.title || t('Nothing playing')}</p>
          {currentTrack?.artist && <p className="mt-0.5 truncate text-xs text-white/45">{currentTrack.artist}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2 justify-self-end">
          <button
            type="button"
            onClick={enterMiniVisualizer}
            title={t('Switch to mini visualizer')}
            aria-label={t('Switch to mini visualizer')}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white/70 backdrop-blur-md transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Minimize2 size={16} />
          </button>
          <button
            type="button"
            onClick={toggleScreen}
            title={screenFull ? t('Exit full screen') : t('Enter full screen')}
            aria-label={screenFull ? t('Exit full screen') : t('Enter full screen')}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white/70 backdrop-blur-md transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {screenFull ? <Minimize size={16} /> : <Expand size={16} />}
          </button>
          <div className="flex h-10 shrink-0 items-center gap-1 rounded-full border border-white/10 bg-black/35 p-1 backdrop-blur-md">
          {enabledPresets.length > 1 && (
            <button type="button" onClick={() => cycle(-1)} title={t('Previous preset')} aria-label={t('Previous preset')}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <ChevronLeft size={17} />
            </button>
          )}
          <span className="max-w-40 truncate px-1 text-xs text-white/75 sm:max-w-56" title={currentPreset || 'MilkDrop'}>{currentPreset || 'MilkDrop'}</span>
          {enabledPresets.length > 1 && (
            <button type="button" onClick={() => cycle(1)} title={t('Next preset')} aria-label={t('Next preset')}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <ChevronRight size={17} />
            </button>
          )}
          </div>
        </div>
      </header>

      <footer onMouseEnter={() => { overChromeRef.current = true; clearTimeout(idleTimerRef.current); setIdle(false) }} onMouseLeave={() => { overChromeRef.current = false; wakeChrome() }} className={"pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-4 bg-gradient-to-t from-black/65 to-transparent px-5 pb-5 pt-14 sm:px-7 sm:pb-6 transition-opacity duration-300 " + (chromeHidden ? "opacity-0" : "opacity-100")}>
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">{t('{count} MilkDrop presets available', { count: enabledPresets.length })}</span>
        <span className="text-[10px] text-white/30">{t('Use the arrow keys to switch presets · Esc to close')}</span>
      </footer>
    </div>
  )
}
