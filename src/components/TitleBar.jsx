import React from 'react'
import { Minus, Square, X } from 'lucide-react'
import { api } from '../api'
import HeaderSearch from './HeaderSearch'

// The window header: app name (the draggable part in the desktop app), the
// Home button and search in the middle, window controls on the right. In the
// browser it's the same bar without the window controls.
export default function TitleBar() {
  const desktop = api.isElectron
  return (
    <div
      className={`${desktop ? 'titlebar' : ''} relative z-40 h-16 grid items-center gap-3 px-4 border-b border-border flex-shrink-0`}
      style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 560px) minmax(0, 1fr)', backgroundColor: 'rgb(var(--surface-rgb) / 0.85)', backdropFilter: 'blur(12px)' }}
    >
      <span className="font-display text-xs text-muted tracking-widest uppercase truncate">Lokal Music</span>

      <HeaderSearch />

      <div className="flex gap-1 justify-end">
        {desktop && (
          <>
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
