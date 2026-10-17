import React, { useEffect, useState } from 'react'
import { Plus, Minus, Loader2 } from 'lucide-react'
import { api } from '../api'
import Modal from './Modal'
import { useTranslation } from '../i18n'

/**
 * Settings > Library > Artists > Separator Words: the words that credit a
 * second artist ("A feat. B", "A (B Remix)", "A (prod. B)"). The built-in
 * ones always work and are only listed; the user's own are added with +,
 * taken off with − and work like "feat.": "A word B", "A (word B)" and
 * "A (B word)" all credit B as well. Saving re-links the library's artists.
 */
export default function SplitWordsSettings() {
  const { t } = useTranslation()
  const [builtIn, setBuiltIn] = useState([])
  const [words, setWords] = useState([])
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState([''])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.resolve(api.getArtistSplitWords?.()).then(result => {
      setBuiltIn(Array.isArray(result?.builtIn) ? result.builtIn : [])
      setWords(Array.isArray(result?.words) ? result.words : [])
    }).catch(() => {})
  }, [])

  const show = () => {
    setDraft(words.length ? [...words] : [''])
    setError(null)
    setOpen(true)
  }
  const change = (index, value) => setDraft(list => list.map((word, i) => (i === index ? value : word)))
  const remove = (index) => setDraft(list => (list.length > 1 ? list.filter((_, i) => i !== index) : ['']))
  const add = () => setDraft(list => [...list, ''])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const result = await api.setArtistSplitWords(draft.map(word => word.trim()).filter(Boolean))
      if (!result || result.ok === false) throw new Error(result?.error || '?')
      setWords(result.words || [])
      // Every credit on screen splits with them now (ArtistNames.jsx).
      try { window.dispatchEvent(new CustomEvent('lokal:split-words-updated', { detail: result.words || [] })) } catch {}
      setOpen(false)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return <>
    <button onClick={show}
      className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
      {t('Configure ({n})', { n: builtIn.length + words.length })}
    </button>
    <Modal open={open} onClose={() => setOpen(false)} title={t('Separator Words')} width="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {t('A word here between two artists, or in brackets with one of them, credits that artist too: with "with" added, "A with B", "A (with B)" and "A (B with)" are the artists A and B. A dot at the end is optional.')}
        </p>
        <div>
          <p className="text-xs font-display text-muted uppercase tracking-widest mb-1.5">{t('Always on')}</p>
          <div className="flex flex-wrap gap-1.5">
            {builtIn.map(word => (
              <span key={word} className="rounded-full border border-border bg-card/60 px-2.5 py-1 text-xs text-white/70">{word}</span>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-display text-muted uppercase tracking-widest mb-1.5">{t('Your words')}</p>
          <div className="space-y-1.5">
            {draft.map((word, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <input value={word} onChange={e => change(index, e.target.value)} placeholder={t('e.g. with')}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
                  autoFocus={index === draft.length - 1 && !word}
                  className="min-w-0 flex-1 bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-accent/50" />
                <button type="button" onClick={() => remove(index)} title={t('Remove')} aria-label={t('Remove')}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted hover:border-red-400/50 hover:text-red-300 transition-colors">
                  <Minus size={14} />
                </button>
              </div>
            ))}
            <button type="button" onClick={add}
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted hover:border-accent/40 hover:text-white transition-colors">
              <Plus size={13} /> {t('Add a word')}
            </button>
          </div>
        </div>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        <div className="flex gap-2">
          <button onClick={() => setOpen(false)} className="flex-1 py-2 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">{t('Cancel')}</button>
          <button onClick={save} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2 bg-accent text-base rounded-xl text-sm font-medium transition-colors disabled:opacity-60">
            {saving && <Loader2 size={14} className="animate-spin" />} {t('Save')}
          </button>
        </div>
      </div>
    </Modal>
  </>
}
