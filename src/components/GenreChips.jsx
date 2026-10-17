import React, { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { genreKey } from '../genres'
import { useTranslation } from '../i18n'

/**
 * The tag editor's genres: the song's own as chips (a click takes one off),
 * then every genre in the library to pick from -- the song's are outlined,
 * and a click on one of those takes it off again, so none is there twice.
 * A genre the library doesn't have yet is typed in and added with Enter.
 */
/** @param listHeight  the library's genres' box: its Tailwind max-height class */
export default function GenreChips({ value = [], onChange, suggestions = [], compact = false, listHeight = null }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const chosen = new Set(value.map(genreKey))
  const toggle = (genre) => {
    const key = genreKey(genre)
    if (!key) return
    onChange(chosen.has(key) ? value.filter(item => genreKey(item) !== key) : [...value, genre.replace(/\s+/g, ' ').trim()])
  }
  const addDraft = () => {
    // A typed "Rock / Pop" is two genres.
    const parts = draft.split(/[\\/;,|]/).map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean)
    const next = [...value]
    for (const part of parts) if (!next.some(item => genreKey(item) === genreKey(part))) next.push(part)
    onChange(next)
    setDraft('')
  }
  const chip = compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
  const others = suggestions.filter(genre => !value.some(item => genreKey(item) === genreKey(genre)))

  return (
    <div className="space-y-1.5">
      <div className="flex min-h-[2.125rem] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5">
        {value.map(genre => (
          <button key={genreKey(genre)} type="button" onClick={() => toggle(genre)} title={t('Remove')}
            className={`group flex items-center gap-1 rounded-full border border-accent/60 bg-accent/10 text-accent transition-colors hover:border-red-400/60 hover:bg-red-500/10 hover:text-red-300 ${chip}`}>
            {genre}
            <X size={11} className="opacity-60 group-hover:opacity-100" />
          </button>
        ))}
        <input value={draft} onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addDraft() } else if (event.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1)) }}
          onBlur={() => { if (draft.trim()) addDraft() }}
          placeholder={value.length ? '' : t('Add a genre…')}
          className="min-w-[6rem] flex-1 bg-transparent text-xs text-white outline-none placeholder:text-muted" />
        {draft.trim() && (
          <button type="button" onMouseDown={event => event.preventDefault()} onClick={addDraft} title={t('Add')} className="text-muted hover:text-accent"><Plus size={13} /></button>
        )}
      </div>
      {suggestions.length > 0 && (
        <div className={`${listHeight || (compact ? 'max-h-20' : 'max-h-24')} overflow-y-auto rounded-lg border border-border bg-card/40 px-2 py-1.5`}>
          <div className="flex flex-wrap gap-1.5">
            {[...value, ...others].map(genre => {
              const on = chosen.has(genreKey(genre))
              return (
                <button key={`s-${genreKey(genre)}`} type="button" onClick={() => toggle(genre)} aria-pressed={on}
                  className={`rounded-full border transition-colors ${chip} ${on ? 'border-accent text-accent' : 'border-border text-muted hover:border-accent/40 hover:text-white'}`}>
                  {genre}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
