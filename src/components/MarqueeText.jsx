import React, { useLayoutEffect, useRef, useState } from 'react'

/**
 * One line that scrolls back and forth when it doesn't fit (pausing at each
 * end and while hovered, so a link in it can be clicked), and sits still
 * when it does. With reduced motion it's a plain horizontally scrollable line.
 */
export default function MarqueeText({ children, className = '', title }) {
  const outerRef = useRef(null)
  const innerRef = useRef(null)
  const [distance, setDistance] = useState(0)

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return undefined
    const measure = () => setDistance(Math.max(0, Math.ceil(inner.scrollWidth - outer.clientWidth)))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [children])

  return (
    <div
      ref={outerRef}
      title={title}
      className={`marquee-text min-w-0 ${className}`}
      data-scrolling={distance > 1 || undefined}
      style={{ '--title-scroll-distance': `${-distance}px`, '--title-scroll-duration': `${Math.max(4, distance / 30 + 2)}s` }}
    >
      <span ref={innerRef} className="marquee-text-inner">{children}</span>
    </div>
  )
}
