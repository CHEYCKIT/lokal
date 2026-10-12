// Synced lyrics as subtitles over a music video: the line being sung, centred
// under the picture, painted syllable by syllable like the full screen
// lyrics (the sweep, the lift, a held note's swell and glow, background
// vocals under it), the dots through an instrumental break. Lines hand over
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

export default function LyricSubtitles({ lines, progress, wordSync = true, bottom }) {
  const reduceMotion = useReducedMotion()
  const clock = useLyricClock(progress)
  const [index, setIndex] = useState(-1)
  const shown = useRef(-1)
  const voices = useRef(new Map()) // line index -> { lead, bg }
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
    if (entry.lead || entry.bg) voices.current.set(i, entry)
    else voices.current.delete(i)
  }
  const nextTime = lines[index + 1]?.time
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
              </>
            )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
