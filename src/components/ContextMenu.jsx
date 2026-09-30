// A right-click menu: opened at the pointer (kept inside the window), in a
// portal above everything. Arrow keys move, Enter picks, Escape, a click
// elsewhere, scrolling or resizing close it.
//
//   const menu = useContextMenu()
//   <div onContextMenu={(e) => menu.open(e, items)} />
//   <ContextMenu menu={menu} />
//
// items: [{ label, icon: LucideIcon, onSelect, danger, disabled, hint }, { separator: true }, ...]

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function useContextMenu() {
  const [state, setState] = useState(null) // { x, y, items }
  const open = useCallback((event, items) => {
    event.preventDefault()
    event.stopPropagation()
    const list = (items || []).filter(Boolean)
    if (list.some(item => !item.separator)) setState({ x: event.clientX, y: event.clientY, items: list })
  }, [])
  const close = useCallback(() => setState(null), [])
  return { state, open, close }
}

/** @param id  the menu element's id (for a button's aria-controls) */
export default function ContextMenu({ menu, id }) {
  const { state, close } = menu
  const ref = useRef(null)
  const [position, setPosition] = useState(null)
  const [active, setActive] = useState(-1)
  const items = state?.items || []
  const choices = items.map((item, index) => (!item.separator && !item.disabled ? index : -1)).filter(index => index >= 0)

  // Kept inside the window: flipped left / up when it would overflow.
  useLayoutEffect(() => {
    if (!state || !ref.current) { setPosition(null); return }
    const { width, height } = ref.current.getBoundingClientRect()
    const margin = 8
    const x = state.x + width + margin > window.innerWidth ? Math.max(margin, state.x - width) : state.x
    const y = state.y + height + margin > window.innerHeight ? Math.max(margin, state.y - height) : state.y
    setPosition({ x, y })
    setActive(-1)
    ref.current.focus({ preventScroll: true })
  }, [state])

  useEffect(() => {
    if (!state) return undefined
    const onPointer = (event) => { if (!ref.current?.contains(event.target)) close() }
    const onKey = (event) => {
      // Only the menu closes (not a selection behind it, too).
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    }
    window.addEventListener('mousedown', onPointer, true)
    window.addEventListener('contextmenu', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    document.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', onPointer, true)
      window.removeEventListener('contextmenu', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [state, close])

  if (!state) return null

  const pick = (item) => {
    if (!item || item.separator || item.disabled) return
    close()
    item.onSelect?.()
  }
  const onKeyDown = (event) => {
    if (!choices.length) return
    const at = choices.indexOf(active)
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(choices[(at + 1) % choices.length]) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(choices[(at - 1 + choices.length) % choices.length]) }
    else if (event.key === 'Home') { event.preventDefault(); setActive(choices[0]) }
    else if (event.key === 'End') { event.preventDefault(); setActive(choices[choices.length - 1]) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(items[active]) }
  }

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-[200] min-w-[13rem] max-w-xs rounded-xl border border-white/10 bg-elevated/95 p-1 shadow-[0_18px_48px_rgba(0,0,0,0.55)] outline-none backdrop-blur-xl"
      style={{ left: position?.x ?? state.x, top: position?.y ?? state.y, visibility: position ? 'visible' : 'hidden', WebkitAppRegion: 'no-drag' }}
    >
      {items.map((item, index) => item.separator ? (
        <div key={`separator-${index}`} role="separator" className="my-1 h-px bg-white/10" />
      ) : (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => pick(item)}
          onMouseEnter={() => setActive(item.disabled ? -1 : index)}
          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors disabled:cursor-default disabled:opacity-40 ${active === index ? (item.danger ? 'bg-red-500/15 text-red-300' : 'bg-white/10 text-white') : item.danger ? 'text-red-400' : 'text-white/85'}`}
        >
          {item.icon && <item.icon size={14} className="flex-shrink-0 opacity-80" />}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.hint && <span className="flex-shrink-0 text-[11px] text-muted">{item.hint}</span>}
        </button>
      ))}
    </div>,
    document.body,
  )
}
