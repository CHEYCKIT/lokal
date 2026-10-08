import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic2, Search, Languages, RotateCcw, Check, ChevronDown, Loader2 } from 'lucide-react'
import LyricsSearchDrawer from './LyricsSearchDrawer'
import LyricBreakDots from './LyricBreakDots'
import { api } from '../api'
import { usePlayerStore } from '../store/player'
import {
  canGrow, activeRows, focusRow, stillSinging, hasNonLatin, groupUnits, withOutroBreak,
} from '../lyrics/timing'
import { stepWord, stepLetters } from '../lyrics/motion'

// ---------------------------------------------------------------------------
// Apple Music-style lyrics.
//
// Everything that moves every frame (the sweep across each syllable, the spring
// of the word being sung, the swell and glow of a held note, the interlude
// dots) is written straight to the DOM from one requestAnimationFrame loop, for
// only the lines actually being sung or still easing back to rest. React renders the list and re-renders
// only when the focused line changes.
// ---------------------------------------------------------------------------

const SUBLINE_KEY = 'lokal-lyrics-subline' // 'original' | 'translation' | 'romanization'
const BROWSE_IDLE_MS = 3200
const FOCUS_LEAD_S = 0.3 // the panel starts moving to a line slightly before it lands
const SCROLL_MS = 560
const STAGGER_STEPS = 3
const STAGGER_FRACTION = 0.07
const EASE = 'cubic-bezier(0.41, 0, 0.12, 0.99)'
const HANDOVER_MS = 420

// Falloff either side of the focused line, indexed by distance. Subtle close in
// (so you can read ahead and behind), letting go further out.
const FALLOFF_ALPHA = [1, 0.6, 0.5, 0.5, 0.5]
const FALLOFF_BLUR = [0, 2.05, 3.2, 4.35, 5.5] // 0.9px + 1.15px per line away, up to 5.5
const UNSUNG = 'rgba(255,255,255,0.42)'
const SUNG = 'rgba(255,255,255,1)'

function readSubline() {
  try { return localStorage.getItem(SUBLINE_KEY) || 'original' } catch { return 'original' }
}
function writeSubline(v) {
  try { localStorage.setItem(SUBLINE_KEY, v) } catch {}
  window.dispatchEvent(new CustomEvent('lokal:lyrics-subline', { detail: v }))
}

// Where the player actually is. An audio element's currentTime advances in
// coarse steps (tens of ms), so animating straight off it looks like a low frame
// rate however fast we paint. Instead one estimate runs on the display clock and
// is pulled gently towards the element's time, which keeps it smooth without
// drifting. A seek (or any big disagreement) snaps it.
function useLyricClock(progress) {
  const anchor = useRef({ t: progress, at: performance.now() })
  useEffect(() => { anchor.current = { t: progress, at: performance.now() } }, [progress])
  const est = useRef({ value: progress, at: 0, raw: -1 })
  return useCallback(() => {
    const frameAt = performance.now()
    const e = est.current
    if (e.at === frameAt) return e.value // every caller within a frame sees the same time
    const s = usePlayerStore.getState()
    const el = s.activeAudioElement === 'cf' ? s.cfAudioRef?.current : s.audioRef?.current
    let raw
    let playing = !!s.isPlaying
    let rate = 1
    if (el && Number.isFinite(el.currentTime) && el.currentTime > 0) {
      raw = el.currentTime
      playing = !el.paused && !el.ended && !el.seeking
      rate = el.playbackRate || 1
    } else {
      const { t, at } = anchor.current
      raw = t + (s.isPlaying ? Math.min((frameAt - at) / 1000, 0.6) : 0)
    }
    const dt = e.at ? Math.min((frameAt - e.at) / 1000, 0.1) : 0
    let next = e.value + (playing ? dt * rate : 0)
    const error = raw - next
    if (!e.at || Math.abs(error) > 0.12 || !playing) next = raw
    else next += error * 0.12
    est.current = { value: next, at: frameAt, raw }
    return next
  }, [])
}

// ---------------------------------------------------------------- word markup

function sweepStyle() {
  return {
    display: 'inline-block',
    whiteSpace: 'pre',
    // The lit part runs to --gp; the edge fades over the next 18% of the word.
    backgroundImage: `linear-gradient(90deg, ${SUNG} 0%, ${SUNG} var(--gp, -20%), ${UNSUNG} calc(var(--gp, -20%) + 18%), ${UNSUNG} 100%)`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'transparent',
    willChange: 'transform, background',
    transformOrigin: 'center 72%',
    // A touch of room so the glow and the lift aren't clipped by the line box.
    paddingBlock: '0.06em',
    marginBlock: '-0.06em',
  }
}

/** One vocal (lead or background): units grouped into unbreakable words. */
function Voice({ units, text, wordSync, className, style, voiceRef }) {
  if (!wordSync || !units?.length) {
    return <span ref={voiceRef} data-voice="plain" dir="auto" className={className} style={style}>{text}</span>
  }
  const groups = groupUnits(units)
  return (
    <span ref={voiceRef} data-voice="timed" dir="auto" className={className} style={style}>
      {groups.map((group, gi) => {
        return (
          <React.Fragment key={gi}>
            {/* One unbreakable box per word; the space sits between boxes so
                the line can still wrap there (a space inside an inline-block
                would be collapsed away). */}
            <span style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
              {group.units.map(({ unit, index }, j) => (
                canGrow(unit) ? (
                  <span key={index} data-u={index} data-grow="1" style={{ display: 'inline-block', whiteSpace: 'pre', willChange: 'transform' }}>
                    {Array.from(unit.word).map((ch, ci) => (
                      <span key={ci} data-l={ci} style={sweepStyle()}>{ch}</span>
                    ))}
                  </span>
                ) : (
                  <span
                    key={index}
                    data-u={index}
                    // Syllables of one word lean in towards their neighbours as they scale (see paintVoice).
                    data-tp={j > 0 ? '1' : undefined}
                    data-tn={j < group.units.length - 1 ? '1' : undefined}
                    style={sweepStyle()}
                  >{unit.word}</span>
                )
              ))}
            </span>
            {group.space ? ' ' : null}
          </React.Fragment>
        )
      })}
    </span>
  )
}

// ---------------------------------------------------------------- per-frame painter

// Last value written per element and property, so a spring's endless sub-pixel
// decay doesn't rewrite the same style every frame.
const written = new WeakMap()
function put(el, prop, value) {
  let m = written.get(el)
  if (!m) { m = {}; written.set(el, m) }
  if (m[prop] === value) return
  m[prop] = value
  if (prop.startsWith('--')) el.style.setProperty(prop, value)
  else el.style[prop] = value
}

function glowShadow(glow, blurBase, blurGain) {
  const a = Math.min(glow * 0.35, 1)
  return a > 0.01 ? `0 0 ${(blurBase + blurGain * glow).toFixed(1)}px rgba(255,255,255,${a.toFixed(3)})` : ''
}

/** Where the lit edge sits for a given fill (0..1): from just off the left to just past the right. */
const gradientPos = (fill) => `${(-20 + 120 * fill).toFixed(2)}%`

/**
 * Advance one vocal to time `t` and write it to the DOM. `dt` is the frame
 * time the springs advance by; `snap` puts every spring straight on its goal
 * (a seek, or bringing an idle line to rest). Returns true while anything in
 * the voice is still moving.
 */
function paintVoice(voiceEl, units, t, dt, snap) {
  if (!voiceEl || !units?.length) return false
  let moving = false
  voiceEl.querySelectorAll('[data-u]').forEach((el) => {
    const u = units[Number(el.dataset.u)]
    if (!u) return
    const w = stepWord(u, t, dt, snap)
    moving = moving || w.moving
    if (el.dataset.grow) {
      // A held syllable moves letter by letter; the syllable itself stays put.
      const steps = stepLetters(u, t, dt, snap)
      el.querySelectorAll('[data-l]').forEach((lEl, li) => {
        const s = steps[li]
        if (!s) return
        moving = moving || s.moving
        put(lEl, '--gp', gradientPos(s.fill))
        put(lEl, 'transform', `translate3d(0, ${s.y.toFixed(4)}em, 0) scale(${s.scale.toFixed(4)})`)
        put(lEl, 'textShadow', glowShadow(s.glow, 4, 12))
      })
      return
    }
    // Scaling shrinks a syllable towards its middle, which would open a gap
    // between it and the rest of its word; pull it back towards its neighbours.
    let pull = 0
    if ((el.dataset.tp || el.dataset.tn) && el.offsetWidth) {
      const inset = el.offsetWidth * (1 - w.scale) / 2
      if (el.dataset.tp) pull -= inset
      if (el.dataset.tn) pull += inset
    }
    put(el, '--gp', gradientPos(w.fill))
    put(el, 'transform', `translate3d(${pull.toFixed(2)}px, ${w.y.toFixed(4)}em, 0) scale(${w.scale.toFixed(4)})`)
    put(el, 'textShadow', glowShadow(w.glow, 4, 2))
  })
  return moving
}

// ---------------------------------------------------------------- rows

const Row = React.memo(function Row({
  line, index, until, clock, distance, isFocused, isLive, isPast, synced, browsing, wordSync, fullscreen, textScale, duet, sub, onSeek, registerRow,
}) {
  const rowRef = useRef(null)
  const leadRef = useRef(null)
  const bgRef = useRef(null)
  const subRef = useRef(null)

  useEffect(() => {
    registerRow(index, { rowEl: rowRef.current, leadEl: leadRef.current, bgEl: bgRef.current, subEl: subRef.current })
    return () => registerRow(index, null)
  })

  const alignEnd = duet && line.side === 'end'
  const baseSize = (fullscreen ? 1.85 : 0.98) * textScale
  // A line still being sung (its backing vocal running past the next line's
  // start, overlapping voices) stays lit alongside the focused one.
  const near = isFocused || isLive ? 0 : distance
  const falloff = browsing ? 0.8 : FALLOFF_ALPHA[Math.min(near, FALLOFF_ALPHA.length - 1)]
  const blur = browsing || !synced ? 0 : FALLOFF_BLUR[Math.min(near, FALLOFF_BLUR.length - 1)]
  const lineOpacity = !synced ? 1 : near === 0 ? 1 : falloff
  const seekable = synced && Number.isFinite(line.time)

  if (line.gap) {
    const open = isFocused && synced
    const breakEnd = Number.isFinite(line.end) && line.end > line.time ? line.end : until
    const exitLead = line.outro ? 0.05 : FOCUS_LEAD_S + 0.04
    return (
      <div ref={rowRef} data-row={index} className="w-full" style={{ willChange: 'transform' }}>
        <div
          style={{
            height: open ? `${baseSize * 1.5}rem` : 0,
            opacity: open ? 1 : 0,
            transition: `height 420ms ${EASE}, opacity 360ms ${EASE}`,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: alignEnd ? 'flex-end' : 'flex-start',
            paddingInline: '0.75rem',
          }}
        >
          <LyricBreakDots start={line.time} end={breakEnd - exitLead} getTime={clock} active={open} size={baseSize * 0.5} align={alignEnd ? 'end' : 'start'} />
        </div>
      </div>
    )
  }

  const hasBg = !!line.bgText
  const subText = sub?.text && sub.text !== line.text ? sub.text : null
  const subBg = sub?.bgText && sub.bgText !== line.bgText ? sub.bgText : null
  const subUnits = sub?.words?.length ? sub.words : null
  const bgUnits = line.bgWords || []

  return (
    <div ref={rowRef} data-row={index} className="w-full" style={{ willChange: 'transform' }}>
      <div
        role={seekable ? 'button' : undefined}
        tabIndex={seekable ? 0 : undefined}
        onClick={() => { if (!seekable) return; const sel = window.getSelection?.(); if (sel && !sel.isCollapsed && sel.toString().trim()) return; onSeek(line.time) }}
        onKeyDown={(e) => { if (seekable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSeek(line.time) } }}
        className={`group rounded-2xl outline-none select-text ${seekable ? 'cursor-pointer hover:bg-white/[0.06] focus-visible:bg-white/[0.06]' : 'cursor-default'}`}
        style={{
          padding: `${baseSize * 0.28}rem 0.75rem`,
          textAlign: alignEnd ? 'right' : 'left',
          marginLeft: duet && alignEnd ? '12%' : 0,
          marginRight: duet && !alignEnd ? '12%' : 0,
          opacity: lineOpacity,
          filter: blur > 0.05 ? `blur(${blur}px)` : 'none',
          transform: synced && near > 0 && !browsing ? 'scale(0.975)' : 'scale(1)',
          transformOrigin: alignEnd ? 'right center' : 'left center',
          // Colour, fade, blur and scale share one duration and curve so a
          // handover reads as one movement: the new line brightens exactly as
          // the old one recedes.
          transition: `opacity ${HANDOVER_MS}ms ${EASE}, filter ${HANDOVER_MS}ms ${EASE}, transform ${HANDOVER_MS}ms ${EASE}`,
        }}
      >
        <div
          dir="auto"
          style={{
            fontSize: `${baseSize}rem`,
            lineHeight: 1.22,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: synced ? (isFocused || isPast ? undefined : UNSUNG) : SUNG,
          }}
        >
          {synced && wordSync && line.words?.length ? (
            <Voice voiceRef={leadRef} units={line.words} text={line.text} wordSync />
          ) : (
            <span
              ref={leadRef}
              data-voice="plain"
              style={{ color: !synced ? SUNG : isFocused ? SUNG : UNSUNG, transition: `color ${HANDOVER_MS}ms ${EASE}` }}
            >
              {line.text}
            </span>
          )}
        </div>
        {hasBg && (
          <div style={{ fontSize: `${baseSize * 0.68}rem`, lineHeight: 1.25, fontWeight: 600, marginTop: '0.15em', opacity: 0.78 }}>
            {synced && wordSync && bgUnits.length ? (
              <Voice voiceRef={bgRef} units={bgUnits} text={line.bgText} wordSync />
            ) : (
              <span ref={bgRef} data-voice="plain" style={{ color: !synced || isFocused ? SUNG : UNSUNG, transition: `color ${HANDOVER_MS}ms ${EASE}` }}>{line.bgText}</span>
            )}
          </div>
        )}
        <AnimatePresence initial={false}>
          {(subText || subBg) && (
            <motion.div
              key="sub"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.42, ease: [0.41, 0, 0.12, 0.99] }}
              style={{ overflow: 'hidden' }}
            >
              <div ref={subRef} dir="auto" style={{ fontSize: `${baseSize * 0.56}rem`, lineHeight: 1.3, fontWeight: 600, marginTop: '0.2em', color: 'rgba(255,255,255,0.72)' }}>
                {subText && (synced && wordSync && subUnits ? <Voice units={subUnits} text={subText} wordSync /> : <span>{subText}</span>)}
                {subBg && <div style={{ fontSize: '0.85em', opacity: 0.8 }}>{subBg}</div>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
})

// ---------------------------------------------------------------- toolbar

// The toolbar's pills fade out by themselves when the full-screen player
// hides its controls (their parent row must not fade: see the row).
const TOOLBAR_FADE = 'transition-[opacity,color,background-color] duration-300 group-data-[hidden=true]/toolbar:opacity-0'

const SYNC_LABEL = { syllable: 'Syllable synced', line: 'Line synced', none: 'Not synced' }

function SourceMenu({ sources, current, attempts, busy, onPick, onRefresh, onSearch, hidden = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  // The toolbar hid (full screen idle): the menu goes with it rather than
  // staying up, unclickable, over the lyrics.
  useEffect(() => { if (hidden) setOpen(false) }, [hidden])
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const label = sources.find(s => s.id === current)?.label || current
  return (
    // It takes the room left beside Translate/Romanize and shortens the
    // source's name to fit (a narrow sidebar cut it off at the edge).
    <div ref={ref} className="relative min-w-0">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex max-w-full items-center gap-1 px-2.5 py-1 rounded-full text-[11px] text-white/60 hover:text-white bg-white/[0.08] hover:bg-white/[0.14] backdrop-blur-md ${TOOLBAR_FADE}`}
        title={label ? `Lyrics source: ${label}` : 'Lyrics source'}
      >
        {busy ? <Loader2 size={11} className="flex-shrink-0 animate-spin" /> : null}
        <span className="min-w-0 max-w-[9rem] truncate">{label || 'Source'}</span>
        <ChevronDown size={11} className="flex-shrink-0" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-full mt-1.5 z-30 w-64 rounded-xl border border-white/10 bg-[#161616]/95 backdrop-blur-xl shadow-2xl p-1"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-white/35">Try another source</p>
            {sources.map(s => {
              const status = attempts?.[s.id]
              const note = status === 'syllable' ? 'Syllable' : status === 'line' ? 'Line' : status === 'none' ? 'Plain' : status === 'miss' ? 'Not found' : ''
              return (
                <button
                  key={s.id}
                  onClick={() => { setOpen(false); onPick(s.id) }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs text-white/80 hover:bg-white/[0.08]"
                >
                  <span className="w-3.5">{s.id === current ? <Check size={12} className="text-accent" /> : null}</span>
                  <span className="flex-1 truncate">{s.label}</span>
                  {note && <span className={`text-[10px] ${status === 'miss' ? 'text-white/25' : 'text-white/45'}`}>{note}</span>}
                </button>
              )
            })}
            <div className="h-px bg-white/10 my-1" />
            <button onClick={() => { setOpen(false); onRefresh() }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs text-white/70 hover:bg-white/[0.08]">
              <RotateCcw size={12} /> Search all sources again
            </button>
            {onSearch && (
              <button onClick={() => { setOpen(false); onSearch() }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs text-white/70 hover:bg-white/[0.08]">
                <Search size={12} /> Search manually...
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Pill({ active, onClick, children, title, disabled }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] ${TOOLBAR_FADE} disabled:opacity-40 ${active ? 'bg-white text-black' : 'text-white/60 hover:text-white bg-white/[0.08] hover:bg-white/[0.14] backdrop-blur-md'}`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- panel

// Lyrics already fetched, per song, shared by every panel (sidebar, full-screen
// player side panel, full-screen lyrics). A panel opened for a song another one
// already shows starts with its lines on the first frame (and refreshes them
// quietly), instead of "no lyrics", then a skeleton, then the lines.
const lyricsCache = new Map() // trackId -> result | null
const LYRICS_CACHE_MAX = 30
function cacheLyrics(trackId, result) {
  lyricsCache.delete(trackId)
  lyricsCache.set(trackId, result)
  if (lyricsCache.size > LYRICS_CACHE_MAX) lyricsCache.delete(lyricsCache.keys().next().value)
}

function Loading() {
  return (
    <div className="w-full flex flex-col gap-5 px-3 pt-4">
      {[0.92, 0.6, 0.8, 0.45, 0.7].map((w, i) => (
        <motion.div
          key={i}
          className="h-6 rounded-lg bg-white/[0.08]"
          style={{ width: `${w * 100}%` }}
          animate={{ opacity: [0.35, 0.8, 0.35] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.1 }}
        />
      ))}
    </div>
  )
}

export default function LyricsPanel({
  track, progress, fullscreen = false, wordSync = true, onLyricsAvailable, onSearchRequest, textScale = 1, isAutoSynced = false,
  // The full screen player hides the buttons along with its own after a few
  // seconds without the mouse moving.
  toolbarHidden = false,
}) {
  const setProgressWithAudioUpdate = usePlayerStore(s => s.setProgressWithAudioUpdate)
  const now = useLyricClock(progress)
  const [result, setResult] = useState(() => (track?.id && lyricsCache.has(track.id) ? lyricsCache.get(track.id) : null))
  // Loading from the first render when there's nothing to show yet, so a new
  // panel never flashes "no lyrics" before its request has even started.
  const [loading, setLoading] = useState(() => !!track?.id && !lyricsCache.has(track.id))
  const [sourceBusy, setSourceBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [sources, setSources] = useState([])
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [subline, setSubline] = useState(readSubline)
  const [translateTarget, setTranslateTarget] = useState('en')
  const [autoTranslate, setAutoTranslate] = useState(false)
  const [translation, setTranslation] = useState({ state: 'idle', lines: null })
  const [romanization, setRomanization] = useState({ state: 'idle', lines: null })
  const [focusIdx, setFocusIdx] = useState(-1)
  const [liveKey, setLiveKey] = useState('')
  const [browsing, setBrowsing] = useState(false)

  const containerRef = useRef(null)
  const rowsRef = useRef(new Map())
  const browseTimer = useRef(null)
  const lastScrollIdx = useRef(-1)
  const paintedRows = useRef(new Set())
  const paintedLines = useRef(null)

  const crossfadeSeconds = usePlayerStore(s => s.crossfadeSeconds)
  const lines = useMemo(
    () => withOutroBreak(result?.lines || [], { duration: track?.duration, crossfade: crossfadeSeconds, synced: result?.type === 'synced' }),
    [result, track?.duration, crossfadeSeconds],
  )
  const synced = result?.type === 'synced'
  const nonLatin = useMemo(() => hasNonLatin(lines), [lines])

  // ---- data
  const trackKey = track?.id
  // Async answers are only applied if they're still for what's on screen.
  // The sidebar and side panel keep this component mounted across track
  // changes, so a slow lookup for the previous song could otherwise land after
  // the next song's and replace its lyrics (same for translations, romanization
  // and the source picker).
  const requestSeq = useRef(0)
  const resultRef = useRef(null)
  resultRef.current = result

  // quiet: lines already on screen (from the cache) stay up while this
  // refreshes them; the answer only replaces them if it's different.
  const load = useCallback((opts = {}, quiet = false) => {
    if (!track?.id) return
    const seq = ++requestSeq.current
    const trackId = track.id
    if (!quiet) setLoading(true)
    setNotice('')
    api.getLyrics(track.id, track.title, track.artist, track.album, track.duration, track.file_path, opts)
      .then(r => {
        if (seq !== requestSeq.current) return
        const next = r && (r.lines?.length || r.instrumental) ? r : null
        cacheLyrics(trackId, next)
        // Same lyrics as shown: keep the scroll position and translations.
        if (quiet && JSON.stringify(next) === JSON.stringify(resultRef.current)) return
        setResult(next)
        // A refreshed result has different lines: drop translations and the
        // scroll position that belonged to the previous one.
        setTranslation({ state: 'idle', lines: null })
        setRomanization({ state: 'idle', lines: null })
        lastScrollIdx.current = -1
      })
      .catch(() => { if (seq === requestSeq.current && !quiet) setResult(null) })
      .finally(() => { if (seq === requestSeq.current) setLoading(false) })
  }, [track?.id, track?.title, track?.artist, track?.album, track?.duration, track?.file_path])

  // Manual search. The fullscreen views bring their own drawer (onSearchRequest);
  // anywhere else -- the sidebar -- the panel opens one over itself.
  const [searchOpen, setSearchOpen] = useState(false)
  const requestSearch = onSearchRequest || (() => setSearchOpen(true))
  const currentTrackId = useRef(track?.id)
  currentTrackId.current = track?.id
  const pickSearchResult = async (lyrics, type) => {
    setSearchOpen(false)
    const trackId = track?.id
    if (!trackId) return
    try { await api.importLyrics(trackId, lyrics, type) } catch {}
    // The song may have changed while saving; its own load already ran.
    if (currentTrackId.current === trackId) load()
  }

  useEffect(() => {
    setSearchOpen(false)
    // A source request for the previous song won't clear its own spinner
    // (its answer is dropped as stale), so clear it here.
    setSourceBusy(false)
    const cached = trackKey != null && lyricsCache.has(trackKey)
    // Cached: its lines show right away (even if the previous song was still
    // loading); otherwise the loading state until this song's answer.
    setResult(cached ? lyricsCache.get(trackKey) : null); setLoading(!cached && trackKey != null); setFocusIdx(-1); lastScrollIdx.current = -1
    setTranslation({ state: 'idle', lines: null }); setRomanization({ state: 'idle', lines: null })
    load({}, cached)
  }, [trackKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!loading) onLyricsAvailable?.(lines.length > 0) }, [loading, lines.length, onLyricsAvailable])

  useEffect(() => {
    api.getLyricsSources?.().then(s => setSources(s?.providers || [])).catch(() => {})
    // Re-read on every Settings save: this panel stays mounted in the sidebar,
    // so a new translation language or Auto-Translate choice must apply live.
    let settingsSeq = 0
    const loadSettings = () => {
      const seq = ++settingsSeq
      api.getSettings().then(s => {
        if (seq !== settingsSeq) return
        setAutoTranslate(s?.lyrics_auto_translate === '1')
        setTranslateTarget(String(s?.lyrics_translate_target || 'en'))
      }).catch(() => {})
    }
    loadSettings()
    window.addEventListener('lokal:settings-saved', loadSettings)
    const onSub = (e) => setSubline(e.detail)
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('lokal:lyrics-subline', onSub)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('lokal:settings-saved', loadSettings)
      window.removeEventListener('lokal:lyrics-subline', onSub)
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  // ---- translation / romanization (source-embedded first, then on demand)
  const compactLines = useMemo(() => lines.map(l => (l.gap ? { gap: true } : { text: l.text, bgText: l.bgText || null })), [lines])
  const embeddedTranslation = useMemo(() => {
    if (!result?.translationLang) return null
    const want = translateTarget.split('-')[0].toLowerCase()
    if (result.translationLang.split('-')[0].toLowerCase() !== want) return null
    return lines.map(l => l.translation || null)
  }, [result, lines, translateTarget])
  // Apple ships a romanization track for e.g. K-pop even when a line is
  // already in English; only offer it when it actually differs somewhere.
  const embeddedRomanization = useMemo(() => (
    lines.some(l => l.romanization?.text && l.romanization.text.trim() !== l.text.trim()) ? lines.map(l => l.romanization || null) : null
  ), [lines])

  // A different target language invalidates whatever was translated before.
  useEffect(() => {
    setTranslation(t => (t.state === 'idle' || t.target === translateTarget ? t : { state: 'idle', lines: null }))
  }, [translateTarget])

  const wantTranslation = subline === 'translation' || (autoTranslate && subline === 'original' && result?.language && !result.language.toLowerCase().startsWith(translateTarget.split('-')[0].toLowerCase()))
  useEffect(() => {
    if (!wantTranslation || !lines.length || embeddedTranslation || translation.state !== 'idle' || !track?.id) return
    setTranslation({ state: 'loading', lines: null, target: translateTarget })
    const forResult = resultRef.current
    const forTarget = translateTarget
    const stale = () => resultRef.current !== forResult
    api.translateLyrics(track.id, compactLines, translateTarget)
      .then(r => { if (!stale()) setTranslation(t => (t.target !== forTarget ? t : r?.status === 'translated' ? { state: 'ready', lines: r.lines, target: forTarget } : { state: r?.status || 'unavailable', lines: null, target: forTarget })) })
      .catch(() => { if (!stale()) setTranslation(t => (t.target !== forTarget ? t : { state: 'unavailable', lines: null, target: forTarget })) })
  }, [wantTranslation, lines.length, embeddedTranslation, translation.state, track?.id, compactLines, translateTarget])

  useEffect(() => {
    if (subline !== 'romanization' || !lines.length || embeddedRomanization || romanization.state !== 'idle' || !track?.id || !nonLatin) return
    setRomanization({ state: 'loading', lines: null })
    const forResult = resultRef.current
    api.romanizeLyrics?.(track.id, compactLines)
      .then(r => { if (resultRef.current === forResult) setRomanization(r?.status === 'romanized' ? { state: 'ready', lines: r.lines } : { state: r?.status || 'unavailable', lines: null }) })
      .catch(() => { if (resultRef.current === forResult) setRomanization({ state: 'unavailable', lines: null }) })
  }, [subline, lines.length, embeddedRomanization, romanization.state, track?.id, nonLatin, compactLines])

  const subLines = useMemo(() => {
    if (wantTranslation) return embeddedTranslation || translation.lines
    if (subline === 'romanization') return embeddedRomanization || romanization.lines
    return null
  }, [wantTranslation, subline, embeddedTranslation, translation.lines, embeddedRomanization, romanization.lines])

  const toggleSub = (mode) => {
    const next = subline === mode ? 'original' : mode
    setSubline(next)
    writeSubline(next)
  }

  // ---- focus (which line the panel is centred on)
  const nextTimes = useMemo(() => lines.map((l, i) => {
    const n = lines.slice(i + 1).find(x => x.time != null)
    return n ? n.time : (track?.duration || (l.time ?? 0) + 4)
  }), [lines, track?.duration])

  useEffect(() => {
    if (!lines.length) return
    if (synced) {
      const t = now()
      const focus = focusRow(lines, t + FOCUS_LEAD_S)
      setFocusIdx(focus)
      setLiveKey(stillSinging(lines, t, focus).join(','))
    } else if (isAutoSynced && track?.duration) {
      setFocusIdx(Math.min(lines.length - 1, Math.floor((progress / track.duration) * lines.length)))
    } else {
      setFocusIdx(-1)
    }
  }, [progress, lines, synced, isAutoSynced, track?.duration, now])

  // ---- per-frame painting of what is actually being sung
  const registerRow = useCallback((index, refs) => {
    if (refs) rowsRef.current.set(index, refs)
    else rowsRef.current.delete(index)
  }, [])

  useEffect(() => {
    if (!synced || !lines.length) return
    let raf
    let lastFrame = performance.now()
    let lastT = now()
    const paintRow = (i, t, dt, snap) => {
      const refs = rowsRef.current.get(i)
      const line = lines[i]
      if (!refs || !line || line.gap || !wordSync) return false
      let moving = paintVoice(refs.leadEl, line.words, t, dt, snap)
      moving = paintVoice(refs.bgEl, line.bgWords, t, dt, snap) || moving
      const sub = subLines?.[i]
      if (sub?.words?.length && refs.subEl) moving = paintVoice(refs.subEl.querySelector('[data-voice="timed"]'), sub.words, t, dt, snap) || moving
      return moving
    }
    const tick = (frameAt) => {
      raf = requestAnimationFrame(tick)
      const t = now()
      const at = typeof frameAt === 'number' ? frameAt : performance.now()
      // Springs advance by real frame time; a stalled tab mustn't fire one huge step.
      const dt = Math.min(0.05, Math.max(0, (at - lastFrame) / 1000))
      lastFrame = at
      // The clock jumped (a seek): every spring goes straight to where it belongs.
      const snap = Math.abs(t - lastT) > 0.6
      lastT = t
      const live = new Set(activeRows(lines, t))
      const next = new Set()
      // A line stays in the loop after it stops being sung until its words have
      // finished easing back to rest.
      for (const i of live) { paintRow(i, t, dt, snap); next.add(i) }
      for (const i of paintedRows.current) {
        if (live.has(i)) continue
        if (paintRow(i, t, dt, snap)) next.add(i)
      }
      paintedRows.current = next
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [synced, lines, nextTimes, now, wordSync, subLines])

  // When the list re-renders, bring every idle timed line to its correct resting
  // state. Lines still being animated are left to the loop above, so a handover
  // doesn't cut the spring of the line that was just sung.
  useLayoutEffect(() => {
    if (!synced || !wordSync) return
    // Row indices from a previous song's lines mean nothing to these ones.
    if (paintedLines.current !== lines) { paintedLines.current = lines; paintedRows.current = new Set() }
    const t = now()
    rowsRef.current.forEach((refs, i) => {
      const line = lines[i]
      if (!line || line.gap || paintedRows.current.has(i)) return
      paintVoice(refs.leadEl, line.words, t, 0, true)
      paintVoice(refs.bgEl, line.bgWords, t, 0, true)
    })
  }, [lines, synced, wordSync, focusIdx, subLines, now])

  // ---- scrolling: native scroll for browsing, a staggered glide for following
  const anchorFraction = fullscreen ? 0.22 : 0.26
  // Full screen, the lyrics start at the top (clear of the buttons and the
  // edge fade) rather than a third of the way down; the line being sung
  // settles at anchorFraction once the song gets there.
  const FULLSCREEN_TOP = { height: '10%', minHeight: '4.5rem' }
  const scrollToFocus = useCallback((instant) => {
    const container = containerRef.current
    const refs = rowsRef.current.get(focusIdx)
    if (!container || !refs?.rowEl) return
    // Near the end of a song the list can't scroll far enough to put the line
    // at the anchor (the sidebar keeps no empty space after the last line), so
    // clamp to how far it can actually go. The last lines then simply light up
    // lower down the panel instead of the list trying to move.
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
    const target = Math.min(maxScroll, Math.max(0, refs.rowEl.offsetTop - container.clientHeight * anchorFraction))
    const before = container.scrollTop
    if (Math.abs(target - before) < 1) return
    if (instant || Math.abs(target - before) > container.clientHeight * 1.5) {
      container.scrollTop = target
      return
    }
    // FLIP: jump the scroll position, then let each row glide the difference
    // back to zero -- rows below the focus leave a beat later than the one
    // above, so the spacing opens and closes like the list is handing over.
    // The glide uses the distance the scroll really moved; gliding by the
    // intended distance when the scroll was clamped made every row jump and
    // settle back to where it already was (the end-of-song jitter).
    container.scrollTop = target
    const delta = container.scrollTop - before
    if (Math.abs(delta) < 1) return
    const top = container.scrollTop
    const bottom = top + container.clientHeight
    rowsRef.current.forEach(({ rowEl }, i) => {
      if (!rowEl) return
      const y = rowEl.offsetTop
      if (y + rowEl.offsetHeight < top - 200 || y > bottom + 200) return
      const steps = i > focusIdx ? Math.min(i - focusIdx, STAGGER_STEPS) : 0
      rowEl.style.transition = 'none'
      rowEl.style.transform = `translate3d(0, ${delta}px, 0)`
      // Force the start frame, then release.
      void rowEl.offsetHeight
      rowEl.style.transition = `transform ${SCROLL_MS}ms ${EASE} ${Math.round(steps * STAGGER_FRACTION * SCROLL_MS)}ms`
      rowEl.style.transform = ''
    })
  }, [focusIdx, anchorFraction])

  useLayoutEffect(() => {
    if (focusIdx < 0 || browsing) return
    const first = lastScrollIdx.current < 0
    lastScrollIdx.current = focusIdx
    scrollToFocus(first)
  }, [focusIdx, browsing, scrollToFocus])

  const startBrowsing = useCallback(() => {
    if (!synced && !isAutoSynced) return
    setBrowsing(true)
    clearTimeout(browseTimer.current)
    browseTimer.current = setTimeout(() => setBrowsing(false), BROWSE_IDLE_MS)
  }, [synced, isAutoSynced])
  useEffect(() => () => clearTimeout(browseTimer.current), [])

  // ---- actions
  const seek = useCallback((time) => {
    if (!Number.isFinite(time)) return
    setBrowsing(false)
    setProgressWithAudioUpdate(Math.max(0, time))
  }, [setProgressWithAudioUpdate])

  const pickSource = (id) => {
    if (!track?.id) return
    const seq = ++requestSeq.current
    setSourceBusy(true)
    api.getLyricsFrom(id, track.id, track.title, track.artist, track.album, track.duration, track.file_path)
      .then(r => {
        if (seq !== requestSeq.current) return
        if (r?.lines?.length) {
          setResult(r)
          setTranslation({ state: 'idle', lines: null })
          setRomanization({ state: 'idle', lines: null })
          lastScrollIdx.current = -1
        } else {
          const label = sources.find(s => s.id === id)?.label || id
          setNotice(`${label} doesn't have this song`)
          setResult(prev => (prev ? { ...prev, attempts: { ...(prev.attempts || {}), ...(r?.attempts || {}) } } : prev))
          setTimeout(() => setNotice(''), 3500)
        }
      })
      .catch(() => {})
      .finally(() => { if (seq === requestSeq.current) setSourceBusy(false) })
  }

  // ---- render
  const liveSet = useMemo(() => new Set(liveKey ? liveKey.split(',').map(Number) : []), [liveKey])
  const sourceLabel = sources.find(s => s.id === result?.source)?.label || result?.source
  const translationBusy = wantTranslation && !embeddedTranslation && translation.state === 'loading'
  const romanizationBusy = subline === 'romanization' && !embeddedRomanization && romanization.state === 'loading'
  const showToolbar = lines.length > 0

  return (
    <div className="relative w-full h-full">
      {showToolbar && (
        <div
          // The pills fade by themselves (TOOLBAR_FADE), not this row: glass
          // inside a fading parent shows as flat grey until the fade ends.
          data-hidden={toolbarHidden}
          className={`group/toolbar absolute top-0 inset-x-0 z-20 flex items-center gap-1.5 px-4 pt-3 pointer-events-none ${fullscreen ? '' : 'pb-6'}`}
          // The sidebar keeps its soft shade behind the buttons; the fullscreen
          // views already have their own header there, so they go without.
          style={fullscreen ? undefined : { background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)' }}
        >
          <div className={`flex flex-shrink-0 items-center gap-1.5 ${toolbarHidden ? 'pointer-events-none' : 'pointer-events-auto'}`} inert={toolbarHidden}>
            <Pill active={wantTranslation} onClick={() => toggleSub('translation')} title={`Show translation (${translateTarget})`}>
              {translationBusy ? <Loader2 size={11} className="animate-spin" /> : <Languages size={11} />}
              Translate
            </Pill>
            {(nonLatin || embeddedRomanization) && (
              <Pill active={subline === 'romanization'} onClick={() => toggleSub('romanization')} title="Show pronunciation in Latin letters">
                {romanizationBusy ? <Loader2 size={11} className="animate-spin" /> : <span className="font-semibold leading-none">Aa</span>}
                Romanize
              </Pill>
            )}
          </div>
          <div className="flex-1" />
          <div className={`flex min-w-0 items-center justify-end gap-1.5 ${toolbarHidden ? 'pointer-events-none' : 'pointer-events-auto'}`} inert={toolbarHidden}>
            {sources.length > 0 && result?.source && (
              <SourceMenu
                sources={sources}
                current={result.source}
                attempts={result.attempts}
                busy={sourceBusy}
                onPick={pickSource}
                onRefresh={() => load({ refresh: true })}
                onSearch={requestSearch}
                hidden={toolbarHidden}
              />
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {(notice || (wantTranslation && translation.state === 'same-language') || (wantTranslation && translation.state === 'unavailable') || (subline === 'romanization' && romanization.state === 'unavailable')) && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            // Right-aligned under the source menu (that's what it answers), and
            // allowed to wrap: a fixed-width, centred pill overflowed the narrow
            // sidebar, and framer's own transform overrode the centring.
            className="absolute top-11 right-4 z-30 max-w-[calc(100%-2rem)] w-max px-3 py-1.5 rounded-2xl bg-black/75 backdrop-blur-md border border-white/10 text-[11px] leading-snug text-white/85 text-right"
          >
            {notice || (translation.state === 'same-language' ? 'Already in your language' : translation.state === 'unavailable' && wantTranslation ? 'Translation unavailable right now' : 'Romanization unavailable right now')}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={containerRef}
        onWheel={startBrowsing}
        onTouchMove={startBrowsing}
        onKeyDown={(e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) startBrowsing() }}
        className="w-full h-full overflow-y-auto overflow-x-hidden"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          // The sidebar has no empty space after the last line, so its closing
          // lines light up near the bottom edge -- keep the fade there short
          // enough not to dim them.
          maskImage: `linear-gradient(to bottom, transparent 0, black 9%, black ${fullscreen ? 82 : 94}%, transparent 100%)`,
          WebkitMaskImage: `linear-gradient(to bottom, transparent 0, black 9%, black ${fullscreen ? 82 : 94}%, transparent 100%)`,
        }}
      >
        <div className={`w-full ${fullscreen ? 'max-w-3xl mx-auto px-6' : 'px-3'}`}>
          {loading && <div style={fullscreen ? FULLSCREEN_TOP : { height: '18%' }} />}
          {loading && <Loading />}

          {!loading && !lines.length && (
            <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-3 text-white/35 select-none pt-24">
              <Mic2 size={fullscreen ? 40 : 28} />
              {result?.instrumental ? (
                <p className={fullscreen ? 'text-sm' : 'text-xs'}>Instrumental — nothing to sing along to.</p>
              ) : !isOnline ? (
                <p className={fullscreen ? 'text-sm' : 'text-xs'}>You're offline. Lyrics will load once you're back online.</p>
              ) : (
                <>
                  <p className={fullscreen ? 'text-sm' : 'text-xs'}>No lyrics found</p>
                  <div className="flex items-center gap-3">
                    <button onClick={requestSearch} className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors">
                      <Search size={12} /> Search manually
                    </button>
                    <button onClick={() => load({ refresh: true })} className="flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors">
                      <RotateCcw size={12} /> Try again
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {!loading && lines.length > 0 && (
            <>
              <div style={fullscreen ? FULLSCREEN_TOP : { height: synced || isAutoSynced ? `${anchorFraction * 100}%` : '3.5rem', minHeight: synced ? '5rem' : undefined }} />
              {!synced && (
                <p className="px-3 pb-3 text-[11px] text-white/35">These lyrics aren't time-synced{isAutoSynced ? ' — following along roughly' : ''}.</p>
              )}
              {lines.map((line, i) => (
                <Row
                  key={i}
                  line={line}
                  index={i}
                  until={nextTimes[i]}
                  clock={now}
                  distance={focusIdx >= 0 ? Math.abs(i - focusIdx) : i + 1}
                  isFocused={i === focusIdx}
                  isLive={liveSet.has(i)}
                  isPast={focusIdx >= 0 && i < focusIdx}
                  synced={synced}
                  browsing={browsing}
                  wordSync={wordSync}
                  fullscreen={fullscreen}
                  textScale={textScale}
                  duet={!!result?.duet}
                  sub={subLines?.[i] || null}
                  onSeek={seek}
                  registerRow={registerRow}
                />
              ))}
              <div style={{ height: fullscreen ? '55vh' : 0 }} />
              {sourceLabel && (
                <p className="px-3 pb-10 text-[11px] text-white/30">
                  Lyrics via {sourceLabel}{result?.sync ? ` · ${SYNC_LABEL[result.sync] || ''}` : ''}
                  {wantTranslation && (embeddedTranslation || translation.lines) ? ` · ${embeddedTranslation ? 'Apple Music translation' : `Translated to ${translateTarget}`}` : ''}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {searchOpen && track && (
          <LyricsSearchDrawer track={track} variant={fullscreen ? 'side' : 'fill'} onClose={() => setSearchOpen(false)} onSelect={pickSearchResult} />
        )}
      </AnimatePresence>
    </div>
  )
}
