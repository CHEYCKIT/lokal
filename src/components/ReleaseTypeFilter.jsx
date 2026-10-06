// "Show: Albums, Singles…": a dropdown of check boxes choosing which release
// types an artist page shows (see releaseTypes.js).

import React, { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react'

/**
 * @param types  [{ type, label, count }] present on the page
 * @param shown  Set of the types shown
 */
export default function ReleaseTypeFilter({ types, shown, onToggle }) {
  const [open, setOpen] = useState(false)
  // Opens upward when there's no room below (the player bar sits over the
  // bottom of the page).
  const [upward, setUpward] = useState(false)
  const ref = useRef(null)
  const toggle = () => {
    if (!open) {
      const rect = ref.current?.getBoundingClientRect()
      setUpward(!!rect && window.innerHeight - rect.bottom < 64 * types.length + 160)
    }
    setOpen(value => !value)
  }
  useEffect(() => {
    if (!open) return undefined
    const close = event => { if (!ref.current?.contains(event.target)) setOpen(false) }
    const escape = event => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  if (types.length < 2) return null
  const visible = types.filter(entry => shown.has(entry.type))
  const summary = visible.length === types.length ? 'All' : visible.length ? visible.map(entry => entry.label).join(', ') : 'None'
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border border-border bg-elevated px-3 py-1 text-xs text-white/75 transition-colors hover:border-accent/40 hover:text-white"
      >
        <SlidersHorizontal size={12} />
        <span className="truncate">Show: {summary}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="group" aria-label="Release types to show" className={`absolute right-0 z-30 w-52 rounded-xl ${upward ? 'bottom-full mb-2' : 'top-full mt-2'} border border-border bg-surface p-1.5 shadow-xl`}>
          {types.map(entry => {
            const on = shown.has(entry.type)
            return (
              <label key={entry.type} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-white/85 hover:bg-white/5">
                <input type="checkbox" className="sr-only" checked={on} onChange={() => onToggle(entry.type)} />
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? 'border-accent bg-accent text-base' : 'border-border'}`}>{on && <Check size={11} strokeWidth={3} />}</span>
                <span className="flex-1">{entry.label}</span>
                <span className="text-xs text-muted">{entry.count}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
