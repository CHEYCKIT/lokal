import React, { useEffect, useRef } from 'react'
import { animate, useReducedMotion } from 'framer-motion'

const format = (n) => Math.round(n).toLocaleString()

/**
 * A number that rolls from its previous value to the new one instead of
 * jumping. `from` is where it starts on mount (0 for a count-up; pass the
 * value itself to show it as-is). Written straight to the DOM, so rolling
 * doesn't re-render the page. Use with `tabular-nums` so the width holds.
 */
export default function AnimatedNumber({ value, from = 0, duration = 0.7, className }) {
  const target = Number(value) || 0
  const ref = useRef(null)
  const shown = useRef(Number(from) || 0)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    // Update React's own text node, so a re-render and the roll agree.
    const node = ref.current?.firstChild
    if (!node) return
    if (reduceMotion || shown.current === target) {
      shown.current = target
      node.nodeValue = format(target)
      return
    }
    const controls = animate(shown.current, target, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        shown.current = latest
        node.nodeValue = format(latest)
      },
    })
    return () => controls.stop()
  }, [target, duration, reduceMotion])

  return <span ref={ref} className={className}>{format(shown.current)}</span>
}
