import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic2, Search, Languages, RotateCcw, Check, ChevronDown, Loader2 } from 'lucide-react'
import { api } from '../api'
import { usePlayerStore } from '../store/player'
import {
  canGrow, growLetters, unitProgress, unitLift, activeRows, focusRow, stillSinging, lineEndOf, hasNonLatin, groupUnits,
} from '../lyrics/timing'

// ---------------------------------------------------------------------------
// Apple Music-style lyrics.
//
// Everything that moves every frame (the sweep across each syllable, the lift
// of the word being sung, the swell and glow of a held note, the interlude
// dots) is written straight to the DOM from one requestAnimationFrame loop, for
// only the lines actually being sung. React renders the list and re-renders
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
const FALLOFF_ALPHA = [1, 0.62, 0.5, 0.42, 0.34]
const FALLOFF_BLUR = [0, 0.8, 1.2, 1.8, 2.4]
const UNSUNG = 'rgba(255,255,255,0.42)'
const SUNG = 'rgba(255,255,255,1)'

function readSubline() {
  try { return localStorage.getItem(SUBLINE_KEY) || 'original' } catch { return 'original' }
}
function writeSubline(v) {
  try { localStorage.setItem(SUBLINE_KEY, v) } catch {}
  window.dispatchEvent(new CustomEvent('lokal:lyrics-subline', { detail: v }))
}

// Where the player actually is, read from the audio element every frame when
// possible (the store's `progress` only updates a few times a second).
function useLyricClock(progress) {
  const anchor = useRef({ t: progress, at: performance.now() })
  useEffect(() => { anchor.current = { t: progress, at: performance.now() } }, [progress])
  return useCallback(() => {
    const s = usePlayerStore.getState()
    const el = s.activeAudioElement === 'cf' ? s.cfAudioRef?.current : s.audioRef?.current
    if (el && Number.isFinite(el.currentTime) && el.currentTime > 0) return el.currentTime
    const { t, at } = anchor.current
    return t + (s.isPlaying ? Math.min((performance.now() - at) / 1000, 0.6) : 0)
  }, [])
}

// ---------------------------------------------------------------- word markup

function sweepStyle() {
  return {
    display: 'inline-block',
    whiteSpace: 'pre',
    backgroundImage: `linear-gradient(90deg, ${SUNG} var(--lo, -0.6em), ${UNSUNG} var(--hi, 0em))`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'transparent',
    willChange: 'transform, background',
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
        const grow = group.units.length === 1 && canGrow(group.units[0].unit)
        return (
          <React.Fragment key={gi}>
            {/* One unbreakable box per word; the space sits between boxes so
                the line can still wrap there (a space inside an inline-block
                would be collapsed away). */}
            <span style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
              {group.units.map(({ unit, index }) => (
                grow ? (
                  <span key={index} data-u={index} data-grow="1" style={{ display: 'inline-block', whiteSpace: 'pre' }}>
                    {Array.from(unit.word).map((ch, ci) => (
                      <span key={ci} data-l={ci} style={sweepStyle()}>{ch}</span>
                    ))}
                  </span>
                ) : (
                  <span key={index} data-u={index} style={sweepStyle()}>{unit.word}</span>
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

function paintVoice(voiceEl, units, t, live) {
  if (!voiceEl || !units?.length) return
  const els = voiceEl.querySelectorAll('[data-u]')
  els.forEach((el) => {
    const u = units[Number(el.dataset.u)]
    if (!u) return
    if (el.dataset.grow) {
      const letters = el.querySelectorAll('[data-l]')
      const plan = growLetters(u)
      letters.forEach((lEl, li) => {
        const s = plan.sample(li, t)
        const p = live ? s.lit : (t >= u.end ? 1 : 0)
        // Feather sits wholly outside the letter at 0 and 1, so an unsung
        // narrow letter ("i", "l") is never caught half-lit.
        lEl.style.setProperty('--lo', `calc(${(p * 100).toFixed(2)}% + ${(p * 0.5 - 0.5).toFixed(3)}em)`)
        lEl.style.setProperty('--hi', `calc(${(p * 100).toFixed(2)}% + ${(p * 0.5).toFixed(3)}em)`)
        if (live) {
          lEl.style.transform = `translate3d(${s.shift.toFixed(3)}em, ${(-s.rise).toFixed(3)}em, 0) scale(${s.scale.toFixed(4)})`
          lEl.style.filter = s.bloom > 0.01 ? `drop-shadow(0 0 ${(0.12 + 0.3 * s.bloom).toFixed(3)}em rgba(255,255,255,${(0.55 * s.bloom).toFixed(3)}))` : ''
        } else {
          lEl.style.transform = ''
          lEl.style.filter = ''
        }
      })
      return
    }
    const p = live ? unitProgress(u, t) : (t >= u.end ? 1 : 0)
    // Feathered edge: the lit region runs to p, fading over ~1.2em around it.
    el.style.setProperty('--lo', `calc(${(p * 100).toFixed(2)}% + ${(p * 1.2 - 0.6).toFixed(3)}em - 0.6em)`)
    el.style.setProperty('--hi', `calc(${(p * 100).toFixed(2)}% + ${(p * 1.2 - 0.6).toFixed(3)}em + 0.6em)`)
    el.style.transform = live ? `translate3d(0, ${(-0.06 * unitLift(u, t)).toFixed(4)}em, 0)` : ''
  })
}

function paintGap(dotsEl, line, until, t) {
  if (!dotsEl) return
  const span = Math.max(0.001, until - line.time)
  const through = Math.min(1, Math.max(0, (t - line.time) / span))
  const dots = dotsEl.children
  for (let i = 0; i < dots.length; i++) {
    const lit = Math.min(1, Math.max(0, through * dots.length - i))
    dots[i].style.opacity = String(0.28 + 0.72 * lit)
  }
  // A gentle breath while it waits; it gathers itself just before the vocal returns.
  const remaining = until - t
  const breath = 1 + 0.06 * Math.sin((t - line.time) * Math.PI * 1.4)
  const gather = remaining < 0.5 ? 1 - 0.25 * (1 - remaining / 0.5) : 1
  dotsEl.style.transform = `scale(${(breath * gather).toFixed(4)})`
}

// ---------------------------------------------------------------- rows

const Row = React.memo(function Row({
  line, index, until, distance, isFocused, isLive, isPast, synced, browsing, wordSync, fullscreen, textScale, duet, sub, onSeek, registerRow,
}) {
  const rowRef = useRef(null)
  const leadRef = useRef(null)
  const bgRef = useRef(null)
  const subRef = useRef(null)
  const dotsRef = useRef(null)

  useEffect(() => {
    registerRow(index, { rowEl: rowRef.current, leadEl: leadRef.current, bgEl: bgRef.current, subEl: subRef.current, dotsEl: dotsRef.current })
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
    return (
      <div ref={rowRef} data-row={index} className="w-full" style={{ willChange: 'transform' }}>
        <div
          style={{
            height: open ? `${baseSize * 1.35}rem` : 0,
            opacity: open ? 1 : 0,
            transition: `height 420ms ${EASE}, opacity 360ms ${EASE}`,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: alignEnd ? 'flex-end' : 'flex-start',
            paddingInline: '0.75rem',
          }}
          aria-label="Instrumental"
        >
          <div ref={dotsRef} className="flex items-center" style={{ gap: `${baseSize * 0.2}rem`, transformOrigin: 'left center' }}>
            {[0, 1, 2].map(i => (
              <span key={i} className="rounded-full bg-white" style={{ width: `${baseSize * 0.36}rem`, height: `${baseSize * 0.36}rem`, opacity: 0.28 }} />
            ))}
          </div>
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

const SYNC_LABEL = { syllable: 'Syllable synced', line: 'Line synced', none: 'Not synced' }

function SourceMenu({ sources, current, attempts, busy, onPick, onRefresh }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const label = sources.find(s => s.id === current)?.label || current
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] text-white/60 hover:text-white bg-white/[0.08] hover:bg-white/[0.14] backdrop-blur-md transition-colors"
        title="Lyrics source"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : null}
        <span className="max-w-[9rem] truncate">{label || 'Source'}</span>
        <ChevronDown size={11} />
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
      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] transition-colors disabled:opacity-40 ${active ? 'bg-white text-black' : 'text-white/60 hover:text-white bg-white/[0.08] hover:bg-white/[0.14] backdrop-blur-md'}`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- panel

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
}) {
  const setProgressWithAudioUpdate = usePlayerStore(s => s.setProgressWithAudioUpdate)
  const now = useLyricClock(progress)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
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

  const lines = result?.lines || []
  const synced = result?.type === 'synced'
  const nonLatin = useMemo(() => hasNonLatin(lines), [lines])

  // ---- data
  const trackKey = track?.id
  const load = useCallback((opts = {}) => {
    if (!track?.id) return
    setLoading(true)
    setNotice('')
    api.getLyrics(track.id, track.title, track.artist, track.album, track.duration, track.file_path, opts)
      .then(r => { setResult(r && (r.lines?.length || r.instrumental) ? r : null) })
      .catch(() => setResult(null))
      .finally(() => setLoading(false))
  }, [track?.id, track?.title, track?.artist, track?.album, track?.duration, track?.file_path])

  useEffect(() => {
    setResult(null); setFocusIdx(-1); lastScrollIdx.current = -1
    setTranslation({ state: 'idle', lines: null }); setRomanization({ state: 'idle', lines: null })
    load()
  }, [trackKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!loading) onLyricsAvailable?.(lines.length > 0) }, [loading, lines.length, onLyricsAvailable])

  useEffect(() => {
    api.getLyricsSources?.().then(s => setSources(s?.providers || [])).catch(() => {})
    api.getSettings().then(s => {
      setAutoTranslate(s?.lyrics_auto_translate === '1')
      if (s?.lyrics_translate_target) setTranslateTarget(String(s.lyrics_translate_target))
    }).catch(() => {})
    const onSub = (e) => setSubline(e.detail)
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('lokal:lyrics-subline', onSub)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
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

  const wantTranslation = subline === 'translation' || (autoTranslate && subline === 'original' && result?.language && !result.language.toLowerCase().startsWith(translateTarget.split('-')[0].toLowerCase()))
  useEffect(() => {
    if (!wantTranslation || !lines.length || embeddedTranslation || translation.state !== 'idle' || !track?.id) return
    setTranslation({ state: 'loading', lines: null })
    api.translateLyrics(track.id, compactLines, translateTarget)
      .then(r => setTranslation(r?.status === 'translated' ? { state: 'ready', lines: r.lines } : { state: r?.status || 'unavailable', lines: null }))
      .catch(() => setTranslation({ state: 'unavailable', lines: null }))
  }, [wantTranslation, lines.length, embeddedTranslation, translation.state, track?.id, compactLines, translateTarget])

  useEffect(() => {
    if (subline !== 'romanization' || !lines.length || embeddedRomanization || romanization.state !== 'idle' || !track?.id || !nonLatin) return
    setRomanization({ state: 'loading', lines: null })
    api.romanizeLyrics?.(track.id, compactLines)
      .then(r => setRomanization(r?.status === 'romanized' ? { state: 'ready', lines: r.lines } : { state: r?.status || 'unavailable', lines: null }))
      .catch(() => setRomanization({ state: 'unavailable', lines: null }))
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
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const t = now()
      const live = new Set(activeRows(lines, t))
      // Lines that just stopped being sung get settled into their final state once.
      for (const i of paintedRows.current) {
        if (live.has(i)) continue
        const refs = rowsRef.current.get(i)
        const line = lines[i]
        if (refs && line && wordSync) {
          paintVoice(refs.leadEl, line.words, t, false)
          paintVoice(refs.bgEl, line.bgWords, t, false)
        }
      }
      for (const i of live) {
        const refs = rowsRef.current.get(i)
        const line = lines[i]
        if (!refs || !line) continue
        if (line.gap) { paintGap(refs.dotsEl, line, nextTimes[i], t); continue }
        if (!wordSync) continue
        paintVoice(refs.leadEl, line.words, t, true)
        paintVoice(refs.bgEl, line.bgWords, t, true)
        const sub = subLines?.[i]
        if (sub?.words?.length && refs.subEl) paintVoice(refs.subEl.querySelector('[data-voice="timed"]'), sub.words, t, true)
      }
      paintedRows.current = live
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [synced, lines, nextTimes, now, wordSync, subLines])

  // When the list re-renders, bring every timed line to its correct resting state.
  useLayoutEffect(() => {
    if (!synced || !wordSync) return
    const t = now()
    rowsRef.current.forEach((refs, i) => {
      const line = lines[i]
      if (!line || line.gap) return
      paintVoice(refs.leadEl, line.words, t, false)
      paintVoice(refs.bgEl, line.bgWords, t, false)
    })
  }, [lines, synced, wordSync, focusIdx, subLines, now])

  // ---- scrolling: native scroll for browsing, a staggered glide for following
  const anchorFraction = fullscreen ? 0.3 : 0.26
  const scrollToFocus = useCallback((instant) => {
    const container = containerRef.current
    const refs = rowsRef.current.get(focusIdx)
    if (!container || !refs?.rowEl) return
    const target = Math.max(0, refs.rowEl.offsetTop - container.clientHeight * anchorFraction)
    const delta = target - container.scrollTop
    if (Math.abs(delta) < 1) return
    if (instant || Math.abs(delta) > container.clientHeight * 1.5) {
      container.scrollTop = target
      return
    }
    // FLIP: jump the scroll position, then let each row glide the difference
    // back to zero -- rows below the focus leave a beat later than the one
    // above, so the spacing opens and closes like the list is handing over.
    container.scrollTop = target
    const top = target
    const bottom = target + container.clientHeight
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
    setSourceBusy(true)
    api.getLyricsFrom(id, track.id, track.title, track.artist, track.album, track.duration, track.file_path)
      .then(r => {
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
      .finally(() => setSourceBusy(false))
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
          className={`absolute top-0 inset-x-0 z-20 flex items-center gap-1.5 px-4 pt-3 pointer-events-none ${fullscreen ? '' : 'pb-6'}`}
          // The sidebar keeps its soft shade behind the buttons; the fullscreen
          // views already have their own header there, so they go without.
          style={fullscreen ? undefined : { background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)' }}
        >
          <div className="flex items-center gap-1.5 pointer-events-auto">
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
          <div className="flex items-center gap-1.5 pointer-events-auto">
            {sources.length > 0 && result?.source && (
              <SourceMenu
                sources={sources}
                current={result.source}
                attempts={result.attempts}
                busy={sourceBusy}
                onPick={pickSource}
                onRefresh={() => load({ refresh: true })}
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
          maskImage: 'linear-gradient(to bottom, transparent 0, black 9%, black 82%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 9%, black 82%, transparent 100%)',
        }}
      >
        <div className={`w-full ${fullscreen ? 'max-w-3xl mx-auto px-6' : 'px-3'}`}>
          {loading && <div style={{ height: fullscreen ? '26vh' : '18%' }} />}
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
                    {onSearchRequest && (
                      <button onClick={onSearchRequest} className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors">
                        <Search size={12} /> Search manually
                      </button>
                    )}
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
              <div style={{ height: synced || isAutoSynced ? `${anchorFraction * 100}%` : '3.5rem', minHeight: synced ? (fullscreen ? '24vh' : '5rem') : undefined }} />
              {!synced && (
                <p className="px-3 pb-3 text-[11px] text-white/35">These lyrics aren't time-synced{isAutoSynced ? ' — following along roughly' : ''}.</p>
              )}
              {lines.map((line, i) => (
                <Row
                  key={i}
                  line={line}
                  index={i}
                  until={nextTimes[i]}
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
              <div style={{ height: fullscreen ? '55vh' : '65%' }} />
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
    </div>
  )
}
