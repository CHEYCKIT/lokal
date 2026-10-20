import React, { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Gamepad2, X } from 'lucide-react'
import { api, peekSettings } from '../api'
import { usePlayerStore } from '../store/player'
import Anomaly from '../visualizers/Anomaly'
import Lightning from '../visualizers/Lightning'
import MilkDrop from '../visualizers/MilkDrop'
import Spectrum from '../visualizers/Spectrum'
import Waves from '../visualizers/Waves'
import { normalizeVisualizerModes, VISUALIZER_MODES } from '../visualizers/modes.mjs'
import { useTranslation } from '../i18n'

export default function FullscreenVisualizer() {
  const { t } = useTranslation()
  const open = usePlayerStore(state => state.showFullscreenVisualizer)
  const setOpen = usePlayerStore(state => state.setShowFullscreenVisualizer)
  const currentTrack = usePlayerStore(state => state.currentTrack)
  const isPlaying = usePlayerStore(state => state.isPlaying)
  const [settings, setSettings] = useState(() => peekSettings() || {})
  const enabled = useMemo(
    () => normalizeVisualizerModes(settings.fullscreen_visualizers),
    [settings.fullscreen_visualizers],
  )
  const enabledKey = enabled.join('|')
  const [visualizer, setVisualizer] = useState(() => {
    const cached = peekSettings() || {}
    const allowed = normalizeVisualizerModes(cached.fullscreen_visualizers)
    return allowed.includes(cached.fullscreen_visualizer) ? cached.fullscreen_visualizer : allowed[0]
  })
  const index = Math.max(0, enabled.indexOf(visualizer))
  const selectedMode = VISUALIZER_MODES.find(mode => mode.id === visualizer) || VISUALIZER_MODES[0]

  useEffect(() => {
    if (!open) return undefined
    let live = true
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
    if (!enabled.includes(visualizer)) setVisualizer(enabled[0])
  }, [enabledKey, visualizer]) // eslint-disable-line react-hooks/exhaustive-deps

  const cycle = delta => {
    if (enabled.length < 2) return
    setVisualizer(enabled[(index + delta + enabled.length) % enabled.length])
  }

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      } else if (event.key === 'ArrowRight' && enabled.length > 1) {
        event.preventDefault()
        event.stopPropagation()
        cycle(1)
      } else if (event.key === 'ArrowLeft' && enabled.length > 1) {
        event.preventDefault()
        event.stopPropagation()
        cycle(-1)
      }
    }
    // Capture Escape before FullscreenPlayer so closing this overlay doesn't
    // also close the regular full-screen player underneath it.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, enabledKey, visualizer]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  let visual
  switch (visualizer) {
    case 'anomaly':
      visual = <Anomaly sensitivity={5} size={1.65} color="accent" className="absolute inset-0 h-full w-full" />
      break
    case 'spectrum':
      visual = <Spectrum isPlaying={isPlaying} bars={240} barWidth={3} height={540} strength={1.1} color="accent" opacity={0.95} radius={2} fill className="absolute inset-0 h-full w-full" />
      break
    case 'waves':
      visual = <Waves isPlaying={isPlaying} width={1920} height={860} strength={1.2} colorBack="accent" colorFront="#ffffff" opacity={0.9} fill className="absolute inset-0 h-full w-full" />
      break
    case 'lightning':
      visual = <Lightning isPlaying={isPlaying} strength={1.15} opacity={0.95} className="absolute inset-0 h-full w-full" />
      break
    case 'milkdrop':
    default:
      visual = <MilkDrop className="absolute inset-0 h-full w-full" isPlaying={isPlaying} trackId={currentTrack?.id} />
      break
  }

  return (
    <div
      data-fullscreen-visualizer=""
      role="dialog"
      aria-modal="true"
      aria-label={t('Full-screen visualizer')}
      className="fixed inset-0 z-[70] overflow-hidden bg-[#030305] text-white"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(46,38,82,0.24),transparent_68%)]" />
      <div className="absolute inset-0">{visual}</div>

      <header className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
        <button
          type="button"
          onClick={() => setOpen(false)}
          title={t('Close full-screen visualizer')}
          aria-label={t('Close full-screen visualizer')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white/75 backdrop-blur-md transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X size={17} />
        </button>

        <div className="min-w-0 flex-1 pt-1 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-display uppercase tracking-[0.24em] text-white/65">
            <Gamepad2 size={15} />
            <span>{t('Full-screen visualizer')}</span>
          </div>
          <p className="mt-1 truncate text-sm font-medium text-white/90">{currentTrack?.title || t('Nothing playing')}</p>
          {currentTrack?.artist && <p className="mt-0.5 truncate text-xs text-white/45">{currentTrack.artist}</p>}
        </div>

        <div className="flex h-10 shrink-0 items-center gap-1 rounded-full border border-white/10 bg-black/35 p-1 backdrop-blur-md">
          {enabled.length > 1 && (
            <button type="button" onClick={() => cycle(-1)} title={t('Previous visualizer')} aria-label={t('Previous visualizer')}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <ChevronLeft size={17} />
            </button>
          )}
          <span className="max-w-28 px-1 text-xs text-white/75 sm:max-w-36">{t(selectedMode.label)}</span>
          {enabled.length > 1 && (
            <button type="button" onClick={() => cycle(1)} title={t('Next visualizer')} aria-label={t('Next visualizer')}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <ChevronRight size={17} />
            </button>
          )}
        </div>
      </header>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-4 bg-gradient-to-t from-black/65 to-transparent px-5 pb-5 pt-14 sm:px-7 sm:pb-6">
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">{t('{count} visualizers available', { count: enabled.length })}</span>
        <span className="text-[10px] text-white/30">{t('Use the arrow keys to switch visualizers · Esc to close')}</span>
      </footer>
    </div>
  )
}
