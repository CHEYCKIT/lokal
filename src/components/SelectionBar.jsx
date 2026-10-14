// The bar shown while items are selected: how many, what can be done with
// them, and a way out. It floats over the bottom of the page (above the
// player bar) instead of being inserted above the list, so nothing moves
// when it comes and goes; it glides in and out.

import { useTranslation } from '../i18n'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'

const GAP = 16

// While a bar is up the page gets room at its bottom, so the last rows can
// still scroll out from under it (room below the content moves nothing): the
// bar's height and its gap, a stacked bar's extra rows included.
let raised = 0
function useRoomBelow(open, room) {
  useEffect(() => {
    const main = open && document.querySelector('main')
    if (!main) return undefined
    raised += 1
    main.style.paddingBottom = `${room}px`
    return () => {
      raised -= 1
      if (!raised) main.style.paddingBottom = ''
    }
  }, [open, room])
}

/** The bar's rendered height, kept up to date as its layout changes. */
function useHeight(open) {
  const [height, setHeight] = useState(0)
  const observer = useRef(null)
  const ref = useCallback(node => {
    observer.current?.disconnect()
    observer.current = null
    if (!node || typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(() => setHeight(node.offsetHeight))
    observer.current.observe(node)
    setHeight(node.offsetHeight)
  }, [])
  useEffect(() => { if (!open) setHeight(0) }, [open])
  return [ref, height]
}

/** Where the page content is on screen (the bar is centred over it). */
function usePageBox(open) {
  const [box, setBox] = useState(null)
  useLayoutEffect(() => {
    if (!open) return undefined
    const main = document.querySelector('main')
    const measure = () => {
      const rect = main?.getBoundingClientRect()
      setBox(rect ? { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.bottom } : null)
    }
    measure()
    const observer = main && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(main)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [open])
  return box
}

/**
 * @param open     whether anything is selected
 * @param label    "3 selected"
 * @param actions  [{ label, icon, onClick, danger, hidden }]
 */
export default function SelectionBar({ open = true, label, actions = [], onClear }) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const box = usePageBox(open)
  const [barRef, barHeight] = useHeight(open)
  useRoomBelow(open, Math.max(88, Math.ceil(barHeight) + GAP * 2))
  // While it glides out, it keeps showing what it last showed (not "0 selected").
  const shown = useRef({ label, actions })
  if (open) shown.current = { label, actions }
  // The roomiest layout that fits on one line: everything; without the hint;
  // or, when even the buttons alone don't fit, "N selected" and the clear
  // button on top with the buttons below (never a lone button on a line).
  // Measured before paint, so a wrong layout never shows.
  const [mode, setMode] = useState('line')
  const rowRef = useRef(null)
  const visible = shown.current.actions.filter(action => !action.hidden)
  const actionsKey = visible.map(action => `${action.label}:${action.disabled ? 1 : 0}`).join('|')
  useLayoutEffect(() => { setMode('line') }, [actionsKey, box?.width, shown.current.label])
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row || mode === 'stacked') return
    if (row.scrollWidth > row.clientWidth + 1) setMode(mode === 'line' ? 'compact' : 'stacked')
  }, [mode, actionsKey, box?.width])
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null

  const rise = reduceMotion ? 0 : 18
  return createPortal(
    <AnimatePresence>
      {open && box && (
        <div className="pointer-events-none fixed z-[60] flex justify-center px-4"
          style={{ left: box.left, width: box.width, bottom: box.bottom + GAP }}>
          <motion.div
            ref={barRef}
            role="toolbar"
            aria-label={shown.current.label}
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0, y: rise, scale: reduceMotion ? 1 : 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: rise * 0.6, scale: reduceMotion ? 1 : 0.98, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
            transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.8 }}
            className="pointer-events-auto flex max-w-full items-center rounded-2xl border border-accent/30 bg-elevated/95 px-4 py-2.5 shadow-[0_18px_48px_rgba(0,0,0,0.55)] backdrop-blur-xl"
          >
            {(() => {
              const buttons = visible.map(({ label: text, icon: Icon, onClick, danger, disabled }) => (
                <button key={text} onClick={onClick} disabled={disabled}
                  className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40 disabled:cursor-default ${danger ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25' : 'border border-border bg-card text-white/80 hover:border-accent/40 hover:text-white'}`}>
                  {Icon && <Icon size={12} />} {t(text)}
                </button>
              ))
              const count = <span className="flex-shrink-0 whitespace-nowrap text-sm font-medium tabular-nums text-accent">{shown.current.label}</span>
              const clear = (
                <button onClick={onClear} title={t("Clear selection (Esc)")} aria-label={t("Clear selection")} className="flex-shrink-0 p-1.5 text-muted transition-colors hover:text-white">
                  <X size={14} />
                </button>
              )
              if (mode === 'stacked') return (
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">{count}{clear}</div>
                  <div className="flex flex-wrap items-center gap-2">{buttons}</div>
                </div>
              )
              return (
                <div ref={rowRef} className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                  {count}
                  {mode === 'line' && <span className="flex-shrink-0 whitespace-nowrap text-[11px] text-muted">{t("Ctrl+click to add · Shift+click for a range · right-click for more")}</span>}
                  <div className="ml-auto flex flex-shrink-0 items-center gap-2 pl-2">{buttons}</div>
                  {clear}
                </div>
              )
            })()}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
