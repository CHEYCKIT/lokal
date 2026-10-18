import { useTranslation } from '../i18n'
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Columns3, LockKeyhole } from 'lucide-react'
import { TRACK_COLUMN_OPTIONS } from '../trackColumns'

// `defs` (key -> { label }), `alwaysShown` (a Set of keys), `otherOptions`
// ([key, label] switches) and the texts make it another list's picker (the
// radio station list); without them it's the song lists'.
export default function TrackColumnPicker({ columns, playlist, onChange, onReset, defs = null, alwaysShown = null, otherOptions = [], buttonLabel = 'Edit song list columns', panelLabel = 'Song list columns', heading = 'Show in song lists', note = 'Saved for all song lists in this profile. Narrow lists tuck Album under Title and fit other columns as space allows.' }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({})
  const button = useRef(null)
  const panel = useRef(null)
  const id = useId()
  const locked = defs ? [...(alwaysShown || [])].map(key => defs[key]?.label || key) : ['Title', 'Album']
  const options = defs
    ? [...otherOptions, ...Object.entries(defs).filter(([key]) => !alwaysShown?.has(key)).map(([key, def]) => [key, def.label])]
    : TRACK_COLUMN_OPTIONS.filter(([key]) => key !== 'grip' || playlist)
  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) button.current?.focus()
  }
  useLayoutEffect(() => {
    if (!open) return
    const anchor = button.current.getBoundingClientRect()
    const rect = panel.current.getBoundingClientRect()
    const below = window.innerHeight - anchor.bottom - 12
    const above = anchor.top - 12
    const upwards = below < rect.height && above > below
    setPosition({
      left: Math.max(8, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8)),
      top: upwards ? undefined : anchor.bottom + 4,
      bottom: upwards ? window.innerHeight - anchor.top + 4 : undefined,
      maxHeight: Math.max(120, upwards ? above : below),
    })
    panel.current.querySelector('input:not(:disabled)')?.focus({ preventScroll: true })
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = event => {
      if (!panel.current?.contains(event.target) && !button.current?.contains(event.target)) close()
    }
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
    }
    const resize = () => close(true)
    const scroll = event => { if (!panel.current?.contains(event.target)) close() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape, true)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape, true)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
    }
  }, [open])

  return <>
    <button ref={button} type="button" title={t(buttonLabel)} aria-label={t(buttonLabel)}
      aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
      onClick={event => { event.stopPropagation(); setOpen(value => !value) }}
      className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:bg-elevated hover:text-text focus-visible:outline focus-visible:outline-accent">
      <Columns3 size={14} /> {t('Columns')}
    </button>
    {open && createPortal(
      <div ref={panel} id={id} role="dialog" aria-label={t(panelLabel)} style={position}
        onClick={event => event.stopPropagation()}
        className="fixed z-[200] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-border bg-elevated p-2 shadow-2xl">
        <p className="px-2 py-1.5 text-xs font-display uppercase tracking-wider text-muted">{t(heading)}</p>
        {locked.map(label => (
          <label key={label} title={t("Always shown")} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted">
            <input type="checkbox" checked disabled className="accent-accent" />
            <span className="flex-1">{t(label)}</span><LockKeyhole size={12} aria-hidden="true" />
          </label>
        ))}
        {options.map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-text hover:bg-card focus-within:bg-card">
            <input type="checkbox" checked={columns[key]} onChange={event => onChange(key, event.target.checked)} className="accent-accent" />
            {t(label)}
          </label>
        ))}
        <p className="border-t border-border px-2 pt-2 text-[11px] leading-relaxed text-muted">{t(note)}</p>
        <button type="button" onClick={onReset} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-accent hover:bg-card">{t("Reset to defaults")}</button>
      </div>, document.body,
    )}
  </>
}
