// Synced lyrics as subtitles over a music video: the line being sung, centred
// under the picture, painted syllable by syllable like the full screen
// lyrics (the sweep, the lift, a held note's swell and glow, background
// vocals under it), the dots through an instrumental break. Under it, the
// line's translation or romanization when one is chosen (subLines, from
// src/lyrics/useLyricSubline.js; a timed romanization is painted too). Lines hand over
// cleanly: the old one fades out, then the new one fades in. One
// requestAnimationFrame loop paints; React re-renders only when the line
// changes.

import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Voice, paintVoice, useLyricClock } from './LyricsPanel'
import LyricBreakDots from './LyricBreakDots'
import { lineEndOf } from '../lyrics/timing'
import { subtitleIndex } from '../lyricLine'

const EASE = [0.41, 0, 0.12, 0.99]

export default function LyricSubtitles({ lines, subLines = null, progress, wordSync = true, bottom }) {
  const reduceMotion = useReducedMotion()
  const clock = useLyricClock(progress)
  const [index, setIndex] = useState(-1)
  const shown = useRef(-1)
  const voices = useRef(new Map()) // line index -> { lead, bg, sub }
  const subLinesRef = useRef(subLines)
  subLinesRef.current = subLines
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const t = clock()
      const next = subtitleIndex(lines, t, lineEndOf)
      if (next !== shown.current) { shown.current = next; setIndex(next) }
      const line = lines[next]
      const els = voices.current.get(next)
      if (line && els) {
        paintVoice(els.lead, line.words, t, true)
        paintVoice(els.bg, line.bgWords, t, true)
        if (els.sub && subLinesRef.current?.[next]?.words?.length) paintVoice(els.sub, subLinesRef.current[next].words, t, true)
      }
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [lines, clock])

  const line = lines[index]
  const keep = (i, part) => el => {
    const entry = voices.current.get(i) || {}
    if (el) entry[part] = el
    else delete entry[part]
    if (entry.lead || entry.bg || entry.sub) voices.current.set(i, entry)
    else voices.current.delete(i)
  }
  const nextTime = lines[index + 1]?.time
  // The translation or romanization of the line, when it differs from the line.
  const sub = line && !line.gap ? subLines?.[index] : null
  const subText = sub?.text && sub.text.trim() !== String(line?.text || '').trim() ? sub.text : null
  const subBg = sub?.bgText && sub.bgText.trim() !== String(line?.bgText || '').trim() ? sub.bgText : null
  return (
    <div className="pointer-events-none absolute inset-x-0 flex justify-center px-10 transition-[bottom] duration-300" style={{ bottom }} aria-live="polite">
      {/* One line at a time: the old one fades out quickly, then the new one
          fades in with a small rise. No blur and no overlap (two lines
          crossing, blurred, read as a jump). */}
      <AnimatePresence mode="wait" initial={false}>
        {line && (
          <motion.div key={index}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: reduceMotion ? 0 : 0.22, ease: EASE } }}
            exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.1, ease: 'easeOut' } }}
            className="relative max-w-[min(68rem,82vw)] px-8 py-3 text-center">
            {/* A soft shade behind the line, so the unsung part reads on a bright picture. */}
            <div aria-hidden className="absolute -inset-x-6 -inset-y-4 -z-10" style={{ background: 'radial-gradient(closest-side, rgba(0,0,0,0.5), rgba(0,0,0,0.25) 55%, transparent)' }} />
            {/* The sweep paints text with a background clip, which a text
                shadow would cover: the shadow goes on the whole line instead. */}
            <div style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.9)) drop-shadow(0 0 1px rgba(0,0,0,0.8))' }}>
            {line.gap ? (
              <div className="flex justify-center">
                <LyricBreakDots start={line.time} end={(Number.isFinite(line.end) && line.end > line.time ? line.end : nextTime ?? line.time + 4) - 0.3} getTime={clock} active size={1.1} align="center" />
              </div>
            ) : (
              <>
                <div dir="auto" className="text-white" style={{ fontSize: 'clamp(1.5rem, 2.7vw, 2.6rem)', fontWeight: 700, lineHeight: 1.22, letterSpacing: '-0.01em' }}>
                  {line.words?.length ? <Voice voiceRef={keep(index, 'lead')} units={line.words} text={line.text} wordSync={wordSync} /> : line.text}
                </div>
                {line.bgText && (
                  <div dir="auto" className="mt-1 text-white/80" style={{ fontSize: 'clamp(1rem, 1.7vw, 1.6rem)', fontWeight: 600, lineHeight: 1.25 }}>
                    {line.bgWords?.length ? <Voice voiceRef={keep(index, 'bg')} units={line.bgWords} text={line.bgText} wordSync={wordSync} /> : line.bgText}
                  </div>
                )}
                {(subText || subBg) && (
                  <div dir="auto" className="mt-1.5 text-white/75" style={{ fontSize: 'clamp(0.95rem, 1.55vw, 1.45rem)', fontWeight: 600, lineHeight: 1.28 }}>
                    {subText && (sub.words?.length && wordSync
                      ? <Voice voiceRef={keep(index, 'sub')} units={sub.words} text={subText} wordSync={wordSync} />
                      : <span>{subText}</span>)}
                    {subBg && <div className="text-white/60" style={{ fontSize: '0.85em' }}>{subBg}</div>}
                  </div>
                )}
              </>
            )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
