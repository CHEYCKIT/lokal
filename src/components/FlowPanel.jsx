// Home → Flow: an endless mix of your music (src/flow/), like Deezer's.
// A mood to play it in, and the Flow Tuner: how adventurous (fresh finds or
// favourites), how recent (lately or all-time), and which genres. Tuner edits
// stay on the page until applied; applied while Flow plays, the songs coming
// up are picked again.

import { useTranslation } from '../i18n'
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Infinity as InfinityIcon, ListPlus, Pause, Play, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import { useShallow } from 'zustand/react/shallow'
import TrackList from './TrackList'
import { showToast } from './Toaster'
import { saveAsPlaylist } from '../trackActions'
import { plural } from '../plural'
import { FLOW_MOODS, flowSource, normalizeTuner, sameTuner, topGenres, trackGenres, DEFAULT_TUNER } from '../flow/engine'
import { ONLINE_SOURCES, onlineError, subscribeOnline } from '../flow/online'
import { MOOD_ICONS } from '../flow/moodIcons'
import { api } from '../api'
import { flowName, flowPool, readFlowSettings, retuneFlow, saveFlowSettings, startFlow, upcoming } from '../flow/session'

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
  const { t } = useTranslation()
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
  const { t } = useTranslation()
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
  const { t } = useTranslation()
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
        <p className="text-sm font-medium text-white">{t("Genres")}</p>
        <p className="text-xs text-muted">{t("Tap to leave one out · add one for more of it")}</p>
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
              placeholder={t("Genre")} aria-label={t("Add a genre")}
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
  const { t } = useTranslation()
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
  // In play order: the shuffle order when shuffle is on.
  const coming = usePlayerStore(useShallow(state => (state.playbackContext?.type === 'flow' ? upcoming(state) : [])))
  const currentTrack = usePlayerStore(state => state.currentTrack)
  const flowOn = context?.type === 'flow'
  const comingUp = coming.slice(0, 5)

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
  // Online finds: the tuner's source, else Discovery's (Home → Discovery's Last.fm / YouTube Music switch).
  const [discoverySource, setDiscoverySource] = useState('lastfm')
  useEffect(() => {
    Promise.resolve(api.getSettings?.()).then(s => setDiscoverySource(s?.recommendation_source === 'youtube' ? 'youtube' : 'lastfm')).catch(() => {})
  }, [])
  const draftSource = flowSource(draft, discoverySource)
  // Shown as soon as a read fails (not on the next unrelated re-render).
  const errorSource = flowOn ? context.source || draftSource : draftSource
  const sourceError = useSyncExternalStore(subscribeOnline, () => onlineError(errorSource))
  const changed = !sameTuner(draft, applied)
  const tuned = !sameTuner(applied, DEFAULT_TUNER)

  const play = async (nextMood = mood, tuner = applied) => {
    if (starting) return
    setStarting(true)
    try {
      const count = await startFlow({ userId, mood: nextMood, tuner })
      if (count === 0) showToast(nextMood === 'flow' ? 'Nothing to play yet. Add music to your library first.' : `No songs in your library fit ${flowName(nextMood)} with this tuner.`)
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
    if (flowOn && await retuneFlow({ userId, mood, tuner })) showToast(t("Flow retuned: the next songs follow your changes"))
    else showToast(t("Flow Tuner saved"))
  }

  const saveUpcoming = async () => {
    if (savingList || !flowOn) return
    setSavingList(true)
    try {
      const tracks = [currentTrack, ...coming].filter(Boolean)
      const name = `${flowName(context.mood)} - ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`
      const playlist = await saveAsPlaylist(name, tracks, { userId, description: 'Saved from Flow' })
      showToast(playlist ? `Saved "${name}" (${plural(tracks.length, 'song')})` : 'Could not create playlist')
    } catch { showToast(t("Could not create playlist")) } finally { setSavingList(false) }
  }

  const playingThis = flowOn && isPlaying

  return (
    <div className="space-y-6">
      {/* The hero: Flow's mark, what it is, and play. */}
      <section className="flow-hero relative overflow-hidden rounded-2xl border border-border p-6 @md:p-8">
        <div className="relative flex flex-col gap-6 @md:flex-row @md:items-center">
          <FlowOrb playing={playingThis} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-display uppercase tracking-[0.25em] text-accent">{t("Flow")}</p>
            <h2 className="mt-1 flex items-center gap-2 text-4xl font-display text-white">
              {flowOn ? flowName(context.mood) : flowName(mood)}<InfinityIcon size={28} className="text-white/50" />
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              Your personal soundtrack{tuned && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider text-white/70">{t("Tuned")}</span>}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => (flowOn ? togglePlay() : play())} disabled={starting}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-60">
                {playingThis ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                {playingThis ? 'Pause' : flowOn ? 'Resume' : starting ? 'Starting…' : 'Play Flow'}
              </button>
              <button type="button" onClick={() => setTunerOpen(open => !open)} aria-expanded={tunerOpen} title={t("Flow Tuner")}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${tunerOpen ? 'border-accent/60 bg-accent/15 text-accent' : 'border-border bg-card text-muted hover:text-white'}`}>
                <SlidersHorizontal size={16} />
              </button>
              {flowOn && (
                <button type="button" onClick={saveUpcoming} disabled={savingList} title={t("Save as playlist")}
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
        <h3 className="mb-3 text-xs font-display uppercase tracking-widest text-muted">{t("Moods")}</h3>
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
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3 px-1">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-medium text-white"><SlidersHorizontal size={15} className="text-accent" />{t("Flow Tuner")}</h3>
                  <p className="mt-0.5 text-xs text-muted">{changed ? 'Edits stay here until you apply them' : 'Shape what Flow plays for you'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setDraft(normalizeTuner(DEFAULT_TUNER))} disabled={sameTuner(draft, DEFAULT_TUNER)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:text-white disabled:opacity-40">
                    <RotateCcw size={12} />Reset
                  </button>
                  <button type="button" onClick={apply} disabled={!changed}
                    className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-base transition-opacity disabled:opacity-40">{t("Apply")}</button>
                </div>
              </div>
              {/* Two cards: how Flow picks (Discovery, Era), and where from (online, genres). */}
              <div className="mt-4 grid gap-4 @lg:grid-cols-2">
              <div className="grid gap-7 rounded-2xl border border-border bg-elevated p-5 @md:p-6">
                <TunerSlider label={t("Discovery")} left="Personal" right="Adventurous" hint="Favourites vs fresh finds"
                  value={draft.adventurous} onChange={value => setDraft(d => ({ ...d, adventurous: value }))} />
                <TunerSlider label={t("Era")} left="All-time" right="Recent" hint="All-time likes vs what you've played lately"
                  value={draft.recent} onChange={value => setDraft(d => ({ ...d, recent: value }))} />
              </div>
              <div className="rounded-2xl border border-border bg-elevated p-5 @md:p-6">
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-white">{t("Fresh finds from")}</p>
                  <p className="text-xs text-muted">{draftSource === 'library' ? 'Only songs in your library' : 'Your library, and songs recommended online'}</p>
                </div>
                <div role="radiogroup" aria-label={t("Fresh finds from")} className="mt-3 inline-flex rounded-full border border-border bg-card p-1">
                  {ONLINE_SOURCES.map(item => (
                    <button key={item.id} type="button" role="radio" aria-checked={draftSource === item.id}
                      onClick={() => setDraft(d => ({ ...d, source: item.id }))}
                      className={`rounded-full px-3.5 py-1.5 text-xs transition-colors ${draftSource === item.id ? 'bg-white text-black' : 'text-muted hover:text-white'}`}>
                      {item.label}
                    </button>
                  ))}
                </div>
                {sourceError && errorSource !== 'library' && (
                  // The playing Flow's source may not be the one selected: the message says whose it is.
                  <p role="status" className="mt-2 text-xs text-amber-300/90">{errorSource !== draftSource ? `${ONLINE_SOURCES.find(item => item.id === errorSource)?.label || errorSource}: ` : ''}{sourceError} Flow keeps to your library meanwhile.</p>
                )}
              </div>
              <div className="mt-7">
                {pool === null ? <p className="text-xs text-muted">{t("Reading your library…")}</p>
                  : <GenreChips suggested={suggested} all={allGenres} genres={draft.genres} onChange={genres => setDraft(d => ({ ...d, genres }))} />}
              </div>
              </div>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {flowOn && comingUp.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-display uppercase tracking-widest text-muted">{t("Coming up in Flow")}</h3>
          <TrackList tracks={comingUp} reduceMotion context={context} />
        </section>
      )}
    </div>
  )
}
