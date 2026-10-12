// Home → Flow: an endless mix of your music (src/flow/), like Deezer's.
// A mood to play it in, and the Flow Tuner: how adventurous (fresh finds or
// favourites), how recent (lately or all-time), and which genres. Tuner edits
// stay on the page until applied; applied while Flow plays, the songs coming
// up are picked again.

import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Brain, CloudRain, Dumbbell, Heart, Infinity as InfinityIcon, ListPlus, Pause, PartyPopper, Play, Plus, RotateCcw, SlidersHorizontal, Waves, X } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import TrackList from './TrackList'
import { showToast } from './Toaster'
import { saveAsPlaylist } from '../trackActions'
import { plural } from '../plural'
import { FLOW_MOODS, normalizeTuner, sameTuner, topGenres, trackGenres, DEFAULT_TUNER } from '../flow/engine'
import { flowName, flowPool, readFlowSettings, retuneFlow, saveFlowSettings, startFlow } from '../flow/session'

const MOOD_ICONS = { flow: InfinityIcon, love: Heart, workout: Dumbbell, chill: Waves, party: PartyPopper, focus: Brain, melancholy: CloudRain }
const MOOD_HINTS = {
  flow: 'Everything you love, and more',
  love: 'Warm, tender, close',
  workout: 'High energy, steady beat',
  chill: 'Slow down, breathe',
  party: 'Danceable and bright',
  focus: 'Instrumental, unobtrusive',
  melancholy: 'For the grey days',
}

/** Flow's mark: soft rings breathing out of a glow, faster while it plays. */
function FlowOrb({ playing }) {
  const reduce = useReducedMotion()
  return (
    <div className={`flow-orb ${playing && !reduce ? 'is-playing' : ''} ${reduce ? 'is-still' : ''}`} aria-hidden="true">
      <span className="flow-orb-glow" />
      <span className="flow-orb-ring" style={{ animationDelay: '0s' }} />
      <span className="flow-orb-ring" style={{ animationDelay: '-1.3s' }} />
      <span className="flow-orb-ring" style={{ animationDelay: '-2.6s' }} />
      <span className="flow-orb-core"><InfinityIcon size={30} strokeWidth={2.4} /></span>
    </div>
  )
}

function TunerSlider({ label, left, right, hint, value, onChange }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <input type="range" min={0} max={100} step={1} value={Math.round(value * 100)} aria-label={label}
        aria-valuetext={`${Math.round((1 - value) * 100)}% ${left}, ${Math.round(value * 100)}% ${right}`}
        onChange={event => onChange(Number(event.target.value) / 100)}
        className="flow-slider mt-3 w-full" style={{ '--flow-fill': `${value * 100}%` }} />
      <div className="mt-1.5 flex justify-between text-[11px] font-display uppercase tracking-wider text-muted">
        <span className={value < 0.5 ? 'text-white' : ''}>{left}</span>
        <span className={value > 0.5 ? 'text-white' : ''}>{right}</span>
      </div>
    </div>
  )
}

const titleCase = genre => genre.replace(/(^|[\s\-/])(\p{L})/gu, (_, gap, letter) => gap + letter.toUpperCase()).replace(/\bR&b\b/i, 'R&B').replace(/\bEdm\b/, 'EDM')

/** The tuner's genres: the library's most common (tap: leave out, tap again: back in), and added ones (more of them). */
function GenreChips({ suggested, all, genres, onChange }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const added = Object.entries(genres).filter(([, on]) => on === true).map(([name]) => name)
  const shown = [...new Set([...suggested, ...added, ...Object.keys(genres)])]
  const toggle = name => {
    const next = { ...genres }
    if (next[name] === undefined) next[name] = false
    else delete next[name]
    onChange(next)
  }
  const add = value => {
    const name = String(value || '').trim().toLowerCase()
    setText('')
    setAdding(false)
    if (name) onChange({ ...genres, [name]: true })
  }
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-white">Genres</p>
        <p className="text-xs text-muted">Tap to leave one out · add one for more of it</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {shown.map(name => {
          const state = genres[name]
          return (
            <button key={name} type="button" onClick={() => toggle(name)} aria-pressed={state !== false}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${state === true ? 'border-accent/60 bg-accent/15 text-accent' : state === false ? 'border-border bg-transparent text-muted line-through decoration-muted/70' : 'border-border bg-card text-white hover:border-white/30'}`}>
              {state === true && <Plus size={11} strokeWidth={3} />}
              {titleCase(name)}
              {state !== undefined && <X size={11} className="opacity-60" />}
            </button>
          )
        })}
        {adding ? (
          <form onSubmit={event => { event.preventDefault(); add(text) }} className="inline-flex">
            <input autoFocus list="flow-genres" value={text} onChange={event => setText(event.target.value)} onBlur={() => (text ? add(text) : setAdding(false))}
              onKeyDown={event => { if (event.key === 'Escape') { setText(''); setAdding(false) } }}
              placeholder="Genre" aria-label="Add a genre"
              className="w-36 rounded-full border border-accent/50 bg-card px-3 py-1.5 text-xs text-white outline-none placeholder:text-muted" />
            <datalist id="flow-genres">{all.map(name => <option key={name} value={titleCase(name)} />)}</datalist>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted hover:border-white/30 hover:text-white">
            <Plus size={12} />Add
          </button>
        )}
      </div>
    </div>
  )
}

export default function FlowPanel({ userId }) {
  const saved = useMemo(() => readFlowSettings(userId), [userId])
  const [mood, setMood] = useState(saved.mood)
  const [applied, setApplied] = useState(saved.tuner)
  const [draft, setDraft] = useState(saved.tuner)
  const [tunerOpen, setTunerOpen] = useState(true)
  const [pool, setPool] = useState(null)
  const [starting, setStarting] = useState(false)
  const [savingList, setSavingList] = useState(false)
  const context = usePlayerStore(state => state.playbackContext)
  const isPlaying = usePlayerStore(state => state.isPlaying)
  const togglePlay = usePlayerStore(state => state.togglePlay)
  const queue = usePlayerStore(state => state.queue)
  const queueIndex = usePlayerStore(state => state.queueIndex)
  const flowOn = context?.type === 'flow'
  const comingUp = flowOn ? queue.slice(queueIndex + 1, queueIndex + 6) : []

  useEffect(() => {
    let live = true
    flowPool(userId).then(rows => { if (live) setPool(rows) })
    return () => { live = false }
  }, [userId])

  const suggested = useMemo(() => topGenres(pool || [], 8), [pool])
  const allGenres = useMemo(() => {
    const names = new Set()
    for (const track of pool || []) for (const genre of trackGenres(track)) names.add(genre)
    return [...names].sort()
  }, [pool])
  const changed = !sameTuner(draft, applied)
  const tuned = !sameTuner(applied, DEFAULT_TUNER)

  const play = async (nextMood = mood, tuner = applied) => {
    if (starting) return
    setStarting(true)
    try {
      const count = await startFlow({ userId, mood: nextMood, tuner })
      if (!count) showToast(nextMood === 'flow' ? 'Nothing to play yet. Add music to your library first.' : `No songs in your library fit ${flowName(nextMood)} with this tuner.`)
    } finally { setStarting(false) }
  }

  const chooseMood = async id => {
    setMood(id)
    saveFlowSettings(userId, { mood: id, tuner: applied })
    // Playing: the songs coming up follow the new mood. Otherwise it starts in it.
    if (flowOn && isPlaying && await retuneFlow({ userId, mood: id, tuner: applied })) return
    await play(id)
  }

  const apply = async () => {
    const tuner = normalizeTuner(draft)
    setApplied(tuner)
    setDraft(tuner)
    saveFlowSettings(userId, { mood, tuner })
    if (flowOn && await retuneFlow({ userId, mood, tuner })) showToast('Flow retuned: the next songs follow your changes')
    else showToast('Flow Tuner saved')
  }

  const saveUpcoming = async () => {
    if (savingList || !flowOn) return
    setSavingList(true)
    try {
      const tracks = queue.slice(Math.max(0, queueIndex))
      const name = `${flowName(context.mood)} - ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`
      const playlist = await saveAsPlaylist(name, tracks, { userId, description: 'Saved from Flow' })
      showToast(playlist ? `Saved "${name}" (${plural(tracks.length, 'song')})` : 'Could not create playlist')
    } catch { showToast('Could not create playlist') } finally { setSavingList(false) }
  }

  const playingThis = flowOn && isPlaying

  return (
    <div className="space-y-6">
      {/* The hero: Flow's mark, what it is, and play. */}
      <section className="flow-hero relative overflow-hidden rounded-2xl border border-border p-6 @md:p-8">
        <div className="relative flex flex-col gap-6 @md:flex-row @md:items-center">
          <FlowOrb playing={playingThis} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-display uppercase tracking-[0.25em] text-accent">Flow</p>
            <h2 className="mt-1 flex items-center gap-2 text-4xl font-display text-white">
              {flowOn ? flowName(context.mood) : flowName(mood)}<InfinityIcon size={28} className="text-white/50" />
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              Your personal soundtrack{tuned && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider text-white/70">Tuned</span>}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => (flowOn ? togglePlay() : play())} disabled={starting}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-60">
                {playingThis ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                {playingThis ? 'Pause' : flowOn ? 'Resume' : starting ? 'Starting…' : 'Play Flow'}
              </button>
              <button type="button" onClick={() => setTunerOpen(open => !open)} aria-expanded={tunerOpen} title="Flow Tuner"
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${tunerOpen ? 'border-accent/60 bg-accent/15 text-accent' : 'border-border bg-card text-muted hover:text-white'}`}>
                <SlidersHorizontal size={16} />
              </button>
              {flowOn && (
                <button type="button" onClick={saveUpcoming} disabled={savingList} title="Save as playlist"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted hover:text-white disabled:opacity-50">
                  <ListPlus size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Moods: a tap plays Flow in it (or retunes the Flow that's playing). */}
      <section>
        <h3 className="mb-3 text-xs font-display uppercase tracking-widest text-muted">Moods</h3>
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {FLOW_MOODS.map(item => {
            const Icon = MOOD_ICONS[item.id]
            const active = (flowOn ? context.mood : mood) === item.id
            return (
              <button key={item.id} type="button" onClick={() => chooseMood(item.id)} aria-pressed={active} title={MOOD_HINTS[item.id]}
                className={`flow-mood group relative inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors ${active ? 'border-transparent bg-accent text-base' : 'border-border bg-card text-white hover:border-white/30'}`}
                data-mood={item.id}>
                <Icon size={15} className={active ? '' : 'text-muted group-hover:text-white'} />
                {item.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* The Flow Tuner. */}
      <AnimatePresence initial={false}>
        {tunerOpen && (
          <motion.section key="tuner" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden">
            <div className="rounded-2xl border border-border bg-elevated p-5 @md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-medium text-white"><SlidersHorizontal size={15} className="text-accent" />Flow Tuner</h3>
                  <p className="mt-0.5 text-xs text-muted">{changed ? 'Edits stay here until you apply them' : 'Shape what Flow plays for you'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setDraft(normalizeTuner(DEFAULT_TUNER))} disabled={sameTuner(draft, DEFAULT_TUNER)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:text-white disabled:opacity-40">
                    <RotateCcw size={12} />Reset
                  </button>
                  <button type="button" onClick={apply} disabled={!changed}
                    className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-base transition-opacity disabled:opacity-40">Apply</button>
                </div>
              </div>
              <div className="mt-6 grid gap-7 @lg:grid-cols-2">
                <TunerSlider label="Discovery" left="Personal" right="Adventurous" hint="Favourites vs fresh finds"
                  value={draft.adventurous} onChange={value => setDraft(d => ({ ...d, adventurous: value }))} />
                <TunerSlider label="Era" left="All-time" right="Recent" hint="All-time likes vs what you've played lately"
                  value={draft.recent} onChange={value => setDraft(d => ({ ...d, recent: value }))} />
              </div>
              <div className="mt-7">
                {pool === null ? <p className="text-xs text-muted">Reading your library…</p>
                  : <GenreChips suggested={suggested} all={allGenres} genres={draft.genres} onChange={genres => setDraft(d => ({ ...d, genres }))} />}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {flowOn && comingUp.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-display uppercase tracking-widest text-muted">Coming up in Flow</h3>
          <TrackList tracks={comingUp} reduceMotion context={context} />
        </section>
      )}
    </div>
  )
}
