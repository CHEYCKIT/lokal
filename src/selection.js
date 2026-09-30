// Selecting several items in a list or grid: Ctrl/Cmd+click adds or removes
// one, Shift+click selects the range from the last clicked item. A plain
// click never selects (it clears the selection and does the item's usual
// thing), so nothing gets selected by accident. With a
// selection, Ctrl/Cmd+A selects everything, Escape clears it and Delete
// (or Backspace) calls onDelete. A right click on an unselected item
// selects just that one first, so the menu acts on what's highlighted.
// One selection at a time: starting one (say in an artist's releases)
// clears any other on the page (their popular songs), so there's only ever
// one selection bar and it's clear what it acts on.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Every selection's clear(), so a new one can clear the others.
const selections = new Set()

const typing = (target) => !!target?.closest?.('input, textarea, select, [contenteditable="true"]')

/**
 * @param keys      the items' keys, in the order they're shown
 * @param onDelete  called with the selected keys on Delete / Backspace
 */
export function useSelection(keys, { onDelete } = {}) {
  const [selected, setSelected] = useState(() => new Set())
  const anchor = useRef(null)
  const keyList = useMemo(() => keys.map(String), [keys])

  // Items that went away (deleted, filtered out) leave the selection.
  useEffect(() => {
    setSelected(current => {
      if (!current.size) return current
      const present = new Set(keyList)
      const kept = [...current].filter(key => present.has(key))
      return kept.length === current.size ? current : new Set(kept)
    })
  }, [keyList])

  const clear = useCallback(() => { anchor.current = null; setSelected(current => (current.size ? new Set() : current)) }, [])

  useEffect(() => {
    selections.add(clear)
    return () => { selections.delete(clear) }
  }, [clear])
  const active = selected.size > 0
  useEffect(() => {
    if (active) selections.forEach(other => { if (other !== clear) other() })
  }, [active, clear])

  const selectAll = useCallback(() => setSelected(new Set(keyList)), [keyList])

  /**
   * A click on an item. Returns true when it only changed the selection
   * (Ctrl/Cmd or Shift held), so the caller skips its usual action (play,
   * open); a plain click clears the selection and returns false.
   */
  const click = useCallback((key, event) => {
    key = String(key)
    if (event.shiftKey && anchor.current !== null) {
      const from = keyList.indexOf(anchor.current)
      const to = keyList.indexOf(key)
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from]
        setSelected(current => {
          const next = event.ctrlKey || event.metaKey ? new Set(current) : new Set()
          for (let i = start; i <= end; i += 1) next.add(keyList[i])
          return next
        })
        return true
      }
    }
    anchor.current = key
    if (event.ctrlKey || event.metaKey) {
      setSelected(current => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      return true
    }
    if (event.shiftKey) {
      setSelected(new Set([key]))
      return true
    }
    setSelected(current => (current.size ? new Set() : current))
    return false
  }, [keyList])

  /** A right click: keeps the selection if the item is in it, else selects just it. */
  const contextSelect = useCallback((key) => {
    key = String(key)
    if (selected.has(key)) return [...selected]
    anchor.current = key
    setSelected(new Set([key]))
    return [key]
  }, [selected])

  useEffect(() => {
    if (!selected.size) return undefined
    const onKey = (event) => {
      if (typing(event.target) || document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')) return
      if (event.key === 'Escape') { clear(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll(); return }
      if ((event.key === 'Delete' || event.key === 'Backspace') && onDelete) { event.preventDefault(); onDelete([...selected]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, clear, selectAll, onDelete])

  return {
    selected,
    count: selected.size,
    has: (key) => selected.has(String(key)),
    click,
    contextSelect,
    clear,
    selectAll,
    set: (list) => setSelected(new Set(list.map(String))),
  }
}
