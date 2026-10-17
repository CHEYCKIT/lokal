import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import GenreChips from './GenreChips'
import { trackGenreList, genreKey } from '../genres'
import { useTranslation } from '../i18n'

const WIDTH = 320
const MARGIN = 8

/**
 * A song's genres edited right where they're shown: a small panel next to the
 * cell (no dimmed or blurred page behind it), the same chips as the tag
 * editor, Save or Cancel. A click outside or Escape cancels.
 */
export default function GenrePopover({ track, anchor, onClose, onSaved }) {
  const { t } = useTranslation()
  const ref = useRef(null)
  const [genres, setGenres] = useState(() => trackGenreList(track))
  const [suggestions, setSuggestions] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [position, setPosition] = useState(null)

  useEffect(() => {
    let active = true
    api.getAllGenres().then(result => { if (active) setSuggestions(Array.isArray(result) ? result : []) }).catch(() => {})
    return () => { active = false }
  }, [])

  // Under the cell, or above it when there's no room below; kept on screen.
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || !anchor) return
    const height = node.offsetHeight
    const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - WIDTH - MARGIN))
    const below = anchor.bottom + 6
    const top = below + height > window.innerHeight - MARGIN ? Math.max(MARGIN, anchor.top - height - 6) : below
    setPosition({ left, top })
  }, [anchor, suggestions.length, genres.length])

  useEffect(() => {
    const onDown = (event) => { if (ref.current && !ref.current.contains(event.target)) onClose() }
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const save = async () => {
    if (genres.map(genreKey).join('\n') === trackGenreList(track).map(genreKey).join('\n')) { onClose(); return }
    setSaving(true)
    setError(null)
    // The first genre is the song's main one; all of them make its list.
    const data = { genre: genres[0] || null, genres: genres.join(', ') || null }
    try {
      const result = await api.updateTrack(track.id, data)
      if (result?.error) { setError(result.error); setSaving(false); return }
      onSaved(result?.track || { ...track, ...data })
      onClose()
    } catch (err) {
      setError(err?.message || String(err))
      setSaving(false)
    }
  }

  return createPortal(
    <div ref={ref} role="dialog" aria-label={t('Genre')}
      onClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}
      style={{ width: WIDTH, left: position?.left ?? -9999, top: position?.top ?? -9999 }}
      className="fixed z-[200] rounded-xl border border-white/10 bg-elevated p-3 shadow-[0_18px_48px_rgba(0,0,0,0.55)]">
      {/* The panel half as tall again as with the tag editor's list: more genres show at once. */}
      <GenreChips compact listHeight="max-h-44" value={genres} onChange={setGenres} suggestions={suggestions} />
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-xs text-muted transition-colors hover:bg-white/10 hover:text-white">
          {t('Cancel')}
        </button>
        <button type="button" onClick={save} disabled={saving}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-base transition-opacity hover:opacity-90 disabled:opacity-50">
          {t('Save')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
