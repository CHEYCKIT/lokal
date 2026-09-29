import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { BarChart3, CalendarRange, Clock3, Disc3, ListMusic, Play, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { api } from '../api'
import { useCachedState, usePageReady } from '../pageCache'
import { useAppStore, usePlayerStore } from '../store/player'
import TrackList from '../components/TrackList'
import FadeImg from '../components/FadeImg'
import { latestPeriod, listenerTimeZone, periodPlace, periodQuery, recapTree, treePeriods } from '../recapPeriods'
import { plural } from '../plural'
import { filteredGenres, fmtDate, fmtHour, fmtMinutes, trackArt } from '../recapText'
import RecapStory from '../components/RecapStory'


function Metric({ label, value, icon: Icon }) {
  return (
    <div className="rounded-xl border border-border bg-elevated/80 p-4">
      <div className="flex items-center gap-2 text-[10px] font-display uppercase tracking-widest text-muted">
        <Icon size={12} />
        {label}
      </div>
      <div className="mt-3 text-2xl font-display text-white">{value}</div>
    </div>
  )
}

function SessionCard({ session, index, onPlay }) {
  const genres = filteredGenres(session.topGenres || []).slice(0, 3)
  const topArtist = session.topArtists?.[0]
  const previewTracks = (session.tracks || []).slice(0, 4)
  const duration = fmtMinutes(session.durationMinutes || 0)

  return (
    <motion.button
      key={session.id || index}
      // No entrance of its own: the page fades in as a whole.
      initial={false}
      onClick={onPlay}
      className="group overflow-hidden rounded-xl border border-border bg-elevated text-left transition-colors hover:border-accent/35"
    >
      <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-display text-white">{session.label}</p>
              <p className="mt-1 text-xs text-muted">{fmtDate(session.start)}</p>
            </div>
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-accent transition-colors group-hover:bg-accent group-hover:text-base">
              <Play size={14} fill="currentColor" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-border/70 bg-card px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-muted">Time</div>
              <div className="mt-1 truncate text-sm text-white">{duration}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-card px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-muted">Tracks</div>
              <div className="mt-1 text-sm text-white">{session.trackCount || 0}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-card px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-muted">Skips</div>
              <div className="mt-1 text-sm text-white">{session.skippedCount || 0}</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {topArtist?.artist && (
              <span className="max-w-full truncate rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-[10px] text-accent">
                {topArtist.artist}
              </span>
            )}
            {genres.map(genre => (
              <span key={genre.genre} className="max-w-full truncate rounded-full border border-border bg-card px-2.5 py-1 text-[10px] text-muted">{genre.genre}</span>
            ))}
          </div>
        </div>

        <div className="grid w-full grid-cols-4 gap-2 sm:w-32 sm:grid-cols-2">
          {previewTracks.map((track, trackIndex) => {
            const art = trackArt(track)
            return (
              <div key={track.id || trackIndex} className="aspect-square overflow-hidden rounded-lg bg-card">
                {art ? <FadeImg src={art} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-muted/50"><Disc3 size={16} /></div>}
              </div>
            )
          })}
          {!previewTracks.length && (
            <div className="col-span-4 flex aspect-[4/1] items-center justify-center rounded-lg bg-card text-xs text-muted sm:col-span-2 sm:aspect-square">No tracks</div>
          )}
        </div>
      </div>
    </motion.button>
  )
}

const SHORT_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** One chip of the period picker. */
function PeriodChip({ active, context, dashed, onClick, children, title }) {
  return (
    <button onClick={onClick} title={title}
      className={`flex-shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-display uppercase tracking-wider transition-colors ${active ? 'border-accent bg-accent text-base' : context ? 'border-accent/60 bg-accent/10 text-accent' : `${dashed ? 'border-dashed' : ''} border-border bg-elevated text-muted hover:text-white`}`}>
      {children}
    </button>
  )
}

// Remounted per user, so one user's cached recap never shows for another.
export default function Recap() {
  const { user } = useAppStore()
  return <RecapContent key={user?.id || 'guest'} user={user} />
}

function RecapContent({ user }) {
  // Kept across visits (per user): coming back shows the recap as it was
  // while the periods refresh quietly, instead of rebuilding it on screen.
  const k = `recap:${user?.id || 'guest'}`
  const [tree, setTree, treeWasCached] = useCachedState(`${k}:tree`, [])
  const [navYear, setNavYear] = useCachedState(`${k}:year`, null)
  const [navMonth, setNavMonth] = useCachedState(`${k}:month`, null) // 'YYYY-MM' whose weeks are shown
  const [selectedId, setSelectedId] = useCachedState(`${k}:selected`, '')
  const [recapsById, setRecapsById] = useCachedState(`${k}:byId`, {})
  const [recap, setRecap] = useCachedState(`${k}:recap`, null)
  // The period the recap on screen belongs to (can lag the selection while
  // the next one loads), so its heading always matches its numbers.
  const [shownId, setShownId] = useCachedState(`${k}:shownId`, '')
  const [periodsError, setPeriodsError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingPeriods, setCheckingPeriods] = useState(!treeWasCached)
  const [status, setStatus] = useState('')
  const [storyOpen, setStoryOpen] = useState(false)
  const { playQueue } = usePlayerStore()
  // The period selected right now, for answers that arrive after a switch.
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  // Each recap load gets a number; only the latest one applies its answer.
  const recapRequestRef = useRef(0)
  const loadingRef = useRef(loading)
  loadingRef.current = loading
  // Keyboard can't reach the dimmed recap either while the next one loads.
  const recapBodyRef = useRef(null)
  useLayoutEffect(() => {
    if (recapBodyRef.current) recapBodyRef.current.inert = loading
  })

  const periods = treePeriods(tree)
  const selectedPeriod = periods.find(period => period.id === selectedId) || null
  const shownPeriod = periods.find(period => period.id === shownId) || selectedPeriod
  const yearEntry = tree.find(y => y.year === navYear) || null
  const monthEntry = yearEntry?.months.find(m => m.key === navMonth) || null
  // Shown once the periods and the selected recap are in, so the page doesn't
  // go "no recap" -> "looking..." -> chips -> "building..." -> recap on screen.
  usePageReady(!checkingPeriods && !loading && (!selectedPeriod || !!recapsById[selectedPeriod.id] || !!status))

  /** Select a period and show where it sits (its year, and its month's weeks). */
  const select = (period, currentTree = tree) => {
    if (!period) return
    const place = periodPlace(currentTree, period.id)
    setSelectedId(period.id)
    if (place) { setNavYear(place.year); setNavMonth(place.monthKey) }
  }

  // Picking a year shows the whole year when it's over, else its latest month or week.
  const pickYear = (entry) => {
    const latestMonth = [...entry.months].reverse().find(m => m.period || m.weeks.length)
    if (entry.period) { setSelectedId(entry.period.id); setNavYear(entry.year); setNavMonth(null); return }
    select(latestMonth?.period || latestMonth?.weeks[latestMonth.weeks.length - 1])
  }

  // Picking a month shows it (or, while it's going, its latest finished week).
  const pickMonth = (entry) => {
    setNavMonth(entry.key)
    if (entry.period) setSelectedId(entry.period.id)
    else if (entry.weeks.length) setSelectedId(entry.weeks[entry.weeks.length - 1].id)
  }

  // Worked out on each load, so Refresh picks up a period that just ended.
  const loadPeriodList = async () => {
    // Quietly when the chips are already on screen (only the icon spins).
    setCheckingPeriods(true)
    setStatus('')
    let days = null
    let failure = 'No answer'
    try {
      const result = await api.getListeningDays(user?.id || 'guest', { tz: listenerTimeZone() })
      if (Array.isArray(result?.days)) days = result.days
      else failure = result?.error || failure
    } catch (e) { failure = e?.message || failure }
    // A failed request keeps the periods (and recap) already shown, and never
    // reads as "no listening data".
    if (!days) {
      if (!tree.length) setPeriodsError(failure)
      setCheckingPeriods(false)
      return
    }
    setPeriodsError('')
    // The selection now, not when the request started (it may have changed).
    const selectedId = selectedIdRef.current
    const nextTree = recapTree(days)
    const available = treePeriods(nextTree)
    // Drop the saved recaps, but keep the one on screen: it stays until the
    // refreshed one replaces it, instead of blanking into "Building recap...".
    setRecapsById(current => (selectedId && current[selectedId] && available.some(p => p.id === selectedId) ? { [selectedId]: current[selectedId] } : {}))
    setTree(nextTree)
    const latest = latestPeriod(nextTree)
    const keep = available.find(period => period.id === selectedId)
    select(keep || latest, nextTree)
    // Same period still selected: its recap is fetched again in the
    // background (the one on screen stays until the fresh one arrives).
    if (keep) refreshRecap(keep)
    if (latest) {
      localStorage.setItem('lokal-recap-latest-completed', latest.id)
      window.dispatchEvent(new CustomEvent('lokal:recap-periods-changed', { detail: { latestId: latest.id } }))
    }
    setCheckingPeriods(false)
  }

  /** Fetch a period's recap again without the loading state; applied only if it's still selected. */
  const refreshRecap = async (period) => {
    try {
      const result = await api.getListeningRecap(user?.id || 'guest', periodQuery(period))
      if (!result || result.error) return
      setRecapsById(current => ({ ...current, [period.id]: result }))
      // Not over a load started since (it has the newer answer on its way).
      if (selectedIdRef.current === period.id && !loadingRef.current) { setRecap(result); setShownId(period.id) }
    } catch {}
  }

  const loadRecap = async () => {
    if (!selectedPeriod) return
    const period = selectedPeriod
    const request = ++recapRequestRef.current
    const current = () => request === recapRequestRef.current && selectedIdRef.current === period.id
    setLoading(true)
    setStatus('')
    try {
      const cached = recapsById[period.id]
      const result = cached || await api.getListeningRecap(user?.id || 'guest', periodQuery(period))
      // A newer load (another period, or this one again) takes over.
      if (!current()) return
      if (result?.error) {
        setStatus(result.error)
        setRecap(null)
      } else {
        setRecap(result)
        setShownId(period.id)
        setRecapsById(current => ({ ...current, [period.id]: result }))
      }
    } catch (e) {
      if (!current()) return
      setStatus(e.message)
      setRecap(null)
    } finally {
      if (request === recapRequestRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    loadPeriodList()
  }, [user?.id])

  useEffect(() => {
    loadRecap()
  }, [selectedId, user?.id])

  useEffect(() => {
    if (!selectedId) return
    localStorage.setItem('lokal-recap-last-viewed', selectedId)
    window.dispatchEvent(new CustomEvent('lokal:recap-viewed', { detail: { periodId: selectedId } }))
  }, [selectedId])

  const topTracks = recap?.topTracks || []
  const replayQueue = recap?.replayQueue || topTracks
  const heroTrack = topTracks[0]
  const heroArt = trackArt(heroTrack)
  const favoriteGenres = filteredGenres(recap?.preferences?.favoriteGenres || [])

  const savePlaylist = async () => {
    // Not while another period loads: the tracks shown are still the old period's.
    if (loading || !replayQueue.length || !selectedPeriod) return
    setStatus('Creating playlist...')
    const name = `${selectedPeriod.title} Top ${Math.min(replayQueue.length, 50)}`
    const playlist = await api.createPlaylist(name, user?.id, `Generated from ${selectedPeriod.title}`)
    if (!playlist?.id) {
      setStatus('Could not create playlist')
      return
    }
    await api.addMultipleToPlaylist(playlist.id, replayQueue.slice(0, 50).map(track => track.id))
    window.dispatchEvent(new CustomEvent('lokal:playlists-changed', { detail: { playlistId: playlist.id, action: 'created' } }))
    setStatus(`Saved ${name}`)
  }

  return (
    <div className="p-6 pb-10 space-y-6 max-w-6xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-display uppercase tracking-widest text-accent">
            <Sparkles size={13} />
            Listening Recaps
          </div>
          <h1 className="mt-2 text-3xl font-display text-white">Your listening eras</h1>
          <p className="mt-1 text-sm text-muted">A recap for every finished week (Monday to Sunday) and month, plus each year, built from your local listening sessions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={loadPeriodList} disabled={checkingPeriods || loading} className="flex items-center gap-2 rounded-xl border border-border bg-elevated px-4 py-2 text-sm text-muted transition-colors hover:text-white disabled:opacity-50">
            <RefreshCw size={14} className={checkingPeriods || loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button onClick={() => replayQueue.length && playQueue(replayQueue, 0)} disabled={loading || !replayQueue.length} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-base transition-colors hover:bg-accent/85 disabled:opacity-50">
            <Play size={14} fill="currentColor" />
            Replay Era
          </button>
          <button onClick={savePlaylist} disabled={loading || !replayQueue.length} className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-50">
            <Plus size={14} />
            Add To Playlists
          </button>
          <button onClick={() => setStoryOpen(true)} disabled={loading || !recap || recap.totalPlays === 0} className="flex items-center gap-2 rounded-xl border border-border bg-elevated px-4 py-2 text-sm text-white transition-colors hover:border-accent/40 disabled:opacity-50">
            <Sparkles size={14} />
            Show Story
          </button>
        </div>
      </div>

      {checkingPeriods && !tree.length ? (
        <div className="rounded-xl border border-border bg-elevated p-6 text-sm text-muted">Looking for finished recaps with listening data...</div>
      ) : periods.length > 0 ? (
        // Year, then month, then week: only periods with plays are listed.
        <div className="space-y-3 rounded-xl border border-border bg-elevated/60 p-4">
          <div className="flex items-center gap-3">
            <span className="w-14 flex-shrink-0 text-[10px] font-display uppercase tracking-widest text-muted">Year</span>
            <div className="flex gap-2 overflow-x-auto pb-0.5">
              {tree.map(entry => (
                <PeriodChip key={entry.year} active={selectedId === entry.period?.id} context={navYear === entry.year && selectedId !== entry.period?.id} onClick={() => pickYear(entry)}
                  title={entry.period ? `The whole of ${entry.year}` : `${entry.year} is still going: pick a month or a week`}>
                  {entry.year}
                </PeriodChip>
              ))}
            </div>
          </div>
          {yearEntry && (
            <div className="flex items-center gap-3">
              <span className="w-14 flex-shrink-0 text-[10px] font-display uppercase tracking-widest text-muted">Month</span>
              <div className="flex gap-2 overflow-x-auto pb-0.5">
                {yearEntry.months.map(entry => (
                  <PeriodChip key={entry.key} active={selectedId === entry.period?.id} context={navMonth === entry.key && selectedId !== entry.period?.id}
                    dashed={!entry.period} title={entry.period ? undefined : 'Still going: pick one of its finished weeks'} onClick={() => pickMonth(entry)}>
                    {SHORT_MONTH_NAMES[entry.month - 1]}
                  </PeriodChip>
                ))}
              </div>
            </div>
          )}
          {monthEntry && monthEntry.weeks.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="w-14 flex-shrink-0 text-[10px] font-display uppercase tracking-widest text-muted">Week</span>
              <div className="flex gap-2 overflow-x-auto pb-0.5">
                {monthEntry.weeks.map(period => (
                  <PeriodChip key={period.id} active={selectedId === period.id} onClick={() => setSelectedId(period.id)}>
                    {period.label}
                  </PeriodChip>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : periodsError ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-elevated p-6 text-sm text-muted">
          Couldn't load your listening days ({periodsError}).
          <button onClick={loadPeriodList} className="rounded-lg border border-border px-3 py-1 text-xs hover:text-white">Retry</button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-elevated p-6 text-sm text-muted">No finished recap periods with listening data yet.</div>
      )}

      {status && <div className="rounded-xl border border-border bg-elevated px-4 py-3 text-sm text-muted">{status}</div>}

      {loading && !recap ? (
        <div className="rounded-xl border border-border bg-elevated p-10 text-center text-sm text-muted">Building recap...</div>
      ) : !recap || recap.totalPlays === 0 ? (
        <div className="rounded-xl border border-border bg-elevated p-10 text-center">
          <Disc3 size={36} className="mx-auto text-muted/40" />
          <p className="mt-3 text-sm text-white">No finished recap selected yet.</p>
          <p className="mt-1 text-xs text-muted">Once a completed period has enough listening data, it will show up here.</p>
        </div>
      ) : (
        // Switching period keeps the current recap (dimmed, not clickable) until the next is built.
        <div ref={recapBodyRef} aria-busy={loading} className={`space-y-6 transition-opacity duration-200 ${loading ? 'pointer-events-none opacity-50' : ''}`}>
          <section className="relative overflow-hidden rounded-xl border border-border bg-elevated">
            {heroArt && <div className="absolute inset-0 bg-cover bg-center opacity-20 blur-xl scale-110" style={{ backgroundImage: `url("${heroArt}")` }} />}
            <div className="relative grid gap-6 p-6 lg:grid-cols-[1fr_260px]">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-display uppercase tracking-widest text-muted">
                  <CalendarRange size={12} />
                  {fmtDate(recap.from)} - {fmtDate(recap.to)}
                </div>
                <h2 className="mt-3 text-4xl font-display text-white">{shownPeriod?.title}</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
                  You played {plural(recap.totalPlays, 'track')} for {fmtMinutes(recap.totalMinutes)}, with {recap.sessions?.length || 0} sessions strong enough to name.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Minutes" value={fmtMinutes(recap.totalMinutes)} icon={Clock3} />
                  <Metric label="Tracks" value={recap.uniqueTracks || 0} icon={ListMusic} />
                  <Metric label="Artists" value={recap.uniqueArtists || 0} icon={BarChart3} />
                  <Metric label="Peak Hour" value={fmtHour(recap.peakHour?.hour)} icon={Clock3} />
                </div>
              </div>
              <div className="rounded-xl border border-border bg-black/20 p-4">
                <div className="aspect-square overflow-hidden rounded-lg bg-card">
                  {heroArt ? <FadeImg src={heroArt} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-muted"><Disc3 size={32} /></div>}
                </div>
                <p className="mt-3 truncate text-sm font-medium text-white">{heroTrack?.title}</p>
                <p className="truncate text-xs text-muted">{heroTrack?.artist}</p>
              </div>
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-display uppercase tracking-widest text-muted">Top Tracks</h2>
                <button onClick={() => playQueue(topTracks, 0)} className="text-xs font-display uppercase tracking-wider text-accent hover:text-accent/70">Play Top 50</button>
              </div>
              <TrackList tracks={topTracks.slice(0, 20)} showAlbum reduceMotion />
            </section>

            <aside className="space-y-4">
              <section className="rounded-xl border border-border bg-elevated p-4">
                <h2 className="text-xs font-display uppercase tracking-widest text-muted">Preference Profile</h2>
                <div className="mt-4 space-y-3">
                  {favoriteGenres.slice(0, 5).map((genre, index) => (
                    <div key={genre.genre || index} className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2">
                      <span className="truncate text-sm text-white">{genre.genre}</span>
                      <span className="text-xs text-muted">{genre.plays}</span>
                    </div>
                  ))}
                  {!favoriteGenres.length && <p className="text-xs text-muted">No specific genre stood out yet.</p>}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-elevated p-4">
                <h2 className="text-xs font-display uppercase tracking-widest text-muted">Top Artists</h2>
                <div className="mt-4 space-y-3">
                  {(recap.topArtists || []).slice(0, 5).map((artist, index) => (
                    <div key={artist.artist || index} className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2">
                      <span className="truncate text-sm text-white">{artist.artist}</span>
                      <span className="text-xs text-muted">{artist.plays}</span>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>

          {recap.sessions?.length > 0 && (
            <section className="space-y-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xs font-display uppercase tracking-widest text-muted">Listening Sessions</h2>
                  <p className="mt-1 text-sm text-muted">Your strongest runs from this recap, grouped by listening shape.</p>
                </div>
                <span className="text-xs text-muted">{recap.sessions.length} named sessions</span>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {recap.sessions.slice(0, 8).map((session, index) => (
                  <SessionCard
                    key={session.id || index}
                    session={session}
                    index={index}
                    onPlay={() => session.tracks?.length && playQueue(session.tracks, 0)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <RecapStory open={storyOpen} onClose={() => setStoryOpen(false)} recap={recap} period={shownPeriod} onSavePlaylist={savePlaylist} playlistStatus={status} />
    </div>
  )
}
