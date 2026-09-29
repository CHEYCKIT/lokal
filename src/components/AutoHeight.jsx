import React, { useLayoutEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

/**
 * A box whose height follows its content smoothly, so a modal whose tabs
 * have different heights (Artist > Manage) glides to the new size instead of
 * jumping. The first measurement is applied without a transition.
 */
export default function AutoHeight({ children, duration = 240, className = '' }) {
  const inner = useRef(null)
  const [height, setHeight] = useState(null)
  const [animate, setAnimate] = useState(false)
  const reduceMotion = useReducedMotion()

  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    setHeight(el.offsetHeight)
    // Transitions start after the first frame, so opening isn't animated.
    const frame = requestAnimationFrame(() => setAnimate(true))
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight))
    observer.observe(el)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [])

  return (
    // A little padding (cancelled by the margin) so focus rings aren't clipped.
    <div
      className={`-m-1 ${className}`}
      style={{
        height: height == null ? 'auto' : height + 8,
        overflow: 'hidden',
        transition: animate && !reduceMotion ? `height ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none',
      }}
    >
      <div ref={inner} className="p-1">{children}</div>
    </div>
  )
}
