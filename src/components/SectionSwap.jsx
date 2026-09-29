import React, { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { PageReadyContext, PageShownContext } from '../pageCache'

// How long a switched-to section may stay hidden waiting for its data.
const SECTION_READY_TIMEOUT_MS = 250

/**
 * Content that swaps with a tab, category or filter (Settings categories,
 * Audio Quality filters, Home / Download tabs). Switching used to show the
 * new section's empty or loading state ("No plugins installed yet",
 * "Loading…", the previous filter's rows) for a few frames before its data.
 *
 * Now a new section starts invisible, waits for its data (a child calls
 * usePageReady(true), as pages do; a `gated` section waits up to
 * SECTION_READY_TIMEOUT_MS) or, ungated, just for its first paint, then fades
 * in. Opacity only, run by the compositor. The section rendered with the page
 * itself shows at once: the page's own fade covers it.
 */
export default function SectionSwap({ id, gated = false, className, children }) {
  const mounted = useRef(false)
  const withPage = !mounted.current
  useEffect(() => { mounted.current = true }, [])
  return (
    <Section key={id} gated={gated} instant={withPage} className={className}>
      {children}
    </Section>
  )
}

function Section({ gated, instant, className, children }) {
  const [ready, setReady] = useState(instant)
  const [shown, setShown] = useState(instant)
  const parentShown = useContext(PageShownContext)
  const ref = useRef(null)

  // Like a page: start the fade two frames after it's ready, so the new
  // section's first render and paint happen while it's still invisible.
  const requested = useRef(instant)
  const markReady = useCallback(() => {
    if (requested.current) return
    requested.current = true
    requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)))
  }, [])

  useLayoutEffect(() => {
    if (!gated) markReady()
  }, [gated, markReady])

  useEffect(() => {
    if (ready) return
    const timer = setTimeout(markReady, SECTION_READY_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [ready, markReady])

  // Hidden content can't take keyboard focus.
  useLayoutEffect(() => {
    if (ref.current) ref.current.inert = !ready
  }, [ready])

  return (
    <PageReadyContext.Provider value={markReady}>
      <PageShownContext.Provider value={parentShown && shown}>
        <motion.div
          ref={ref}
          className={className}
          initial={instant ? false : { opacity: 0 }}
          animate={{ opacity: ready ? 1 : 0 }}
          transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          onAnimationComplete={() => { if (ready) setShown(true) }}
        >
          {children}
        </motion.div>
      </PageShownContext.Provider>
    </PageReadyContext.Provider>
  )
}

/** Marks the enclosing page or section ready: for code that can't call the hook itself. */
export function ReadyWhen({ ready }) {
  const markReady = useContext(PageReadyContext)
  useLayoutEffect(() => {
    if (ready) markReady?.()
  }, [ready, markReady])
  return null
}
