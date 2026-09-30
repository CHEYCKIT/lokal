// The bar over a list or grid while items are selected: how many, what can be
// done with them, and a way out. Sticks to the top while scrolling.

import React from 'react'
import { X } from 'lucide-react'

/** actions: [{ label, icon, onClick, danger, hidden }] */
export default function SelectionBar({ label, actions = [], onClear }) {
  return (
    <div onClick={(event) => event.stopPropagation()}
      className="sticky top-2 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-elevated/95 px-4 py-2 shadow-lg shadow-black/30 backdrop-blur-md">
      <span className="text-sm font-medium text-accent">{label}</span>
      <span className="hidden text-[11px] text-muted lg:inline">Ctrl+click to add · Shift+click for a range · right-click for more</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {actions.filter(action => !action.hidden).map(({ label: text, icon: Icon, onClick, danger }) => (
          <button key={text} onClick={onClick}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${danger ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25' : 'border border-border bg-card text-white/80 hover:border-accent/40 hover:text-white'}`}>
            {Icon && <Icon size={12} />} {text}
          </button>
        ))}
        <button onClick={onClear} title="Clear selection (Esc)" aria-label="Clear selection" className="p-1.5 text-muted transition-colors hover:text-white">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
