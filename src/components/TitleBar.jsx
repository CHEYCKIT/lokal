import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Minus, Settings, Square, X } from 'lucide-react'
import { api } from '../api'
import HeaderSearch from './HeaderSearch'
import { DownloadManagerPanel, DownloadsButton } from './DownloadManager'

/**
 * The window header: app name (the draggable part in the desktop app), the
 * Home button and search in the middle; on the right Downloads, then Settings
 * nearest the edge (the downloads panel opens inwards, so Settings stays in
 * reach), then the window controls. In the browser it's the same bar without
 * the window controls.
 */
export default function TitleBar() {
  const desktop = api.isElectron
  const nav = useNavigate()
  const onSettings = useLocation().pathname === '/settings'
  return (
    <div
      className={`${desktop ? 'titlebar' : ''} relative z-40 h-[35px] grid items-center gap-3 px-3 border-b border-border flex-shrink-0`}
      style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 520px) minmax(0, 1fr)', backgroundColor: 'rgb(var(--surface-rgb) / 0.85)', backdropFilter: 'blur(12px)' }}
    >
      <span className="font-display text-xs text-muted tracking-widest uppercase truncate">Lokal Music</span>

      <HeaderSearch />

      <div className="flex items-center gap-1 justify-end">
        <DownloadsButton />
        <button
          type="button"
          data-tour="settings"
          onClick={() => nav('/settings')}
          title="Settings"
          aria-label="Settings"
          aria-current={onSettings ? 'page' : undefined}
          className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${onSettings ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-elevated hover:text-text'}`}
        >
          <Settings size={15} />
        </button>
        <DownloadManagerPanel />
        {desktop && (
          <>
            <span className="mx-1 h-4 w-px bg-border2" aria-hidden="true" />
            <button
              onClick={() => window.electron?.minimize()}
              className="w-7 h-7 rounded flex items-center justify-center text-muted hover:text-text hover:bg-elevated transition-colors"
            >
              <Minus size={12} />
            </button>
            <button
              onClick={() => window.electron?.maximize()}
              className="w-7 h-7 rounded flex items-center justify-center text-muted hover:text-text hover:bg-elevated transition-colors"
            >
              <Square size={11} />
            </button>
            <button
              onClick={() => window.electron?.close()}
              className="w-7 h-7 rounded flex items-center justify-center text-muted hover:bg-red/30 hover:text-red transition-colors"
            >
              <X size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
