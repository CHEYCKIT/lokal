import React, { useEffect, useRef, useState } from 'react'
import { GripVertical, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react'
import { api } from '../api'

// Settings > Lyrics > Sources: which lyrics sources are asked, and in what
// order. Saved as you change it (no Save button) -- the next lookup uses it.
//
//   lyrics_sources_order    JSON array of source ids, first = tried first
//   lyrics_sources_enabled  JSON array of the ids switched on
//   lyrics_prioritize_syllable '1' = keep searching past a line-synced match
//                              for a syllable-synced one

export default function LyricsSourcesSettings({ onPersist } = {}) {
  const [providers, setProviders] = useState([])
  const [order, setOrder] = useState([])
  const [enabled, setEnabled] = useState([])
  const [defaultOrder, setDefaultOrder] = useState([])
  const [prioritize, setPrioritize] = useState(false)
  const [spicyKey, setSpicyKey] = useState('')
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef(null)

  useEffect(() => {
    api.getLyricsSources?.().then(s => {
      if (!s) return
      setProviders(s.providers || [])
      setOrder(s.order || [])
      setEnabled(s.enabled || [])
      setDefaultOrder(s.defaultOrder || [])
      setPrioritize(!!s.prioritizeSyllable)
    }).catch(() => {})
    api.getSettings?.().then(s => setSpicyKey(String(s?.spicylyrics_api_key || ''))).catch(() => {})
    return () => clearTimeout(savedTimer.current)
  }, [])

  const persist = (patch) => {
    // Settings holds every key in its own state and writes all of them on
    // "Save Settings"; keep it in step, or a later save would restore the
    // old source order over this one.
    onPersist?.(patch)
    api.saveSettings(patch).then(() => {
      setSaved(true)
      clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 1400)
    }).catch(() => {})
  }

  const byId = Object.fromEntries(providers.map(p => [p.id, p]))
  const rows = [...order, ...providers.map(p => p.id).filter(id => !order.includes(id))].filter(id => byId[id])

  const saveOrder = (next) => { setOrder(next); persist({ lyrics_sources_order: JSON.stringify(next) }) }
  const move = (id, delta) => {
    const i = rows.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    saveOrder(next)
  }
  const toggle = (id) => {
    const turningOff = enabled.includes(id)
    // At least one source must stay on: an empty list isn't "no lyrics" to the
    // lookup, it falls back to every source -- the opposite of what the
    // switches would show.
    if (turningOff && enabled.filter(x => rows.includes(x)).length <= 1) return
    const next = turningOff ? enabled.filter(x => x !== id) : [...enabled, id]
    setEnabled(next)
    // Store the expanded order too. This records that the user has seen the
    // migrated SpicyLyrics row, so a deliberate disable remains disabled.
    persist({ lyrics_sources_enabled: JSON.stringify(next), lyrics_sources_order: JSON.stringify(rows) })
  }
  const drop = (targetId) => {
    if (!dragId || dragId === targetId) return
    // Dropped on a row below it: land after that row; above it: before it.
    // (Always inserting before made a one-row drag downwards do nothing.)
    const movingDown = rows.indexOf(dragId) < rows.indexOf(targetId)
    const next = rows.filter(id => id !== dragId)
    next.splice(next.indexOf(targetId) + (movingDown ? 1 : 0), 0, dragId)
    saveOrder(next)
  }
  const reset = () => {
    setOrder(defaultOrder); setEnabled(defaultOrder); setPrioritize(false)
    persist({ lyrics_sources_order: JSON.stringify(defaultOrder), lyrics_sources_enabled: JSON.stringify(defaultOrder), lyrics_prioritize_syllable: '0' })
  }

  if (!providers.length) return null

  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-4 mb-1">
        <p className="text-sm text-white">Lyrics sources</p>
        <span className={`text-[11px] transition-opacity ${saved ? 'opacity-100 text-accent' : 'opacity-0'}`}>Saved</span>
      </div>
      <p className="text-xs text-muted mb-3">
        Sources are tried in this order. Drag to reorder them. The first source with lyrics wins unless syllable lyrics are prioritized.
      </p>
      <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
        {rows.map((id, index) => {
          const p = byId[id]
          const on = enabled.includes(id)
          return (
            <div
              key={id}
              draggable
              onDragStart={(e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => { e.preventDefault(); setOverId(id) }}
              onDragLeave={() => setOverId(o => (o === id ? null : o))}
              onDrop={(e) => { e.preventDefault(); drop(id); setDragId(null); setOverId(null) }}
              onDragEnd={() => { setDragId(null); setOverId(null) }}
              className={`flex items-center gap-3 px-3 py-2.5 bg-card transition-colors ${overId === id && dragId && dragId !== id ? 'bg-accent/10' : ''} ${dragId === id ? 'opacity-50' : ''}`}
            >
              <GripVertical size={14} className="text-muted cursor-grab shrink-0" />
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${on ? 'text-white' : 'text-muted'}`}>
                  {p.label}
                  {p.wordSynced && <span className="ml-2 text-[10px] uppercase tracking-wider text-accent/70">Syllable</span>}
                </p>
                <p className="text-xs text-muted truncate">{p.detail}</p>
              </div>
              <div className="flex flex-col shrink-0">
                <button onClick={() => move(id, -1)} disabled={index === 0} className="text-muted hover:text-white disabled:opacity-20" aria-label={`Move ${p.label} up`}><ChevronUp size={13} /></button>
                <button onClick={() => move(id, 1)} disabled={index === rows.length - 1} className="text-muted hover:text-white disabled:opacity-20" aria-label={`Move ${p.label} down`}><ChevronDown size={13} /></button>
              </div>
              <button
                role="switch"
                aria-checked={on}
                disabled={on && enabled.filter(x => rows.includes(x)).length <= 1}
                title={on && enabled.filter(x => rows.includes(x)).length <= 1 ? 'At least one source has to stay on' : undefined}
                onClick={() => toggle(id)}
                className={`relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${on ? 'bg-accent' : 'bg-white/15'}`}
                aria-label={`${on ? 'Disable' : 'Enable'} ${p.label}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-4 mt-4">
        <div>
          <p className="text-sm text-white">Prioritize syllable lyrics</p>
          <p className="text-xs text-muted">Keep searching past a line-synced match for word-by-word lyrics</p>
        </div>
        <button
          onClick={() => { const v = !prioritize; setPrioritize(v); persist({ lyrics_prioritize_syllable: v ? '1' : '0' }) }}
          className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${prioritize ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}
        >
          {prioritize ? 'On' : 'Off'}
        </button>
      </div>

      <div className="mt-5 space-y-2">
        <div>
          <p className="text-sm text-white">Spicy Lyrics secret key <span className="text-muted">(optional)</span></p>
          <p className="text-xs text-muted">Create a secret key at <a href="https://developers.spicylyrics.org/dashboard/applications" target="_blank" rel="noreferrer" className="text-accent hover:underline">developers.spicylyrics.org</a>. It stays in Lokal's backend; a Spotify account isn't required.</p>
        </div>
        <input
          type="password"
          value={spicyKey}
          onChange={event => setSpicyKey(event.target.value)}
          onBlur={() => persist({ spicylyrics_api_key: spicyKey.trim() })}
          placeholder="SpicyLyrics API key"
          autoComplete="off"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
        />
      </div>

      <button onClick={reset} className="mt-4 flex items-center gap-1.5 text-xs text-muted hover:text-white transition-colors">
        <RotateCcw size={12} /> Reset to default
      </button>
    </div>
  )
}
