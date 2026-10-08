import React, { useState } from 'react'

/** Reveal an overflowing title on hover without moving titles that already fit. */
export default function HoverScrollTitle({ title = '', className = '' }) {
  const [distance, setDistance] = useState(0)
  return (
    <p
      className={`truncate hover-scroll-title ${className}`}
      title={title}
      data-scrolling={distance > 0 || undefined}
      onMouseEnter={event => setDistance(Math.max(0, event.currentTarget.scrollWidth - event.currentTarget.clientWidth))}
      onMouseLeave={() => setDistance(0)}
      style={{ '--title-scroll-distance': `${-distance}px`, '--title-scroll-duration': `${Math.max(4, distance / 35 + 2)}s` }}
    >
      {distance > 0 ? <span className="hover-scroll-title-text">{title}</span> : title}
    </p>
  )
}
