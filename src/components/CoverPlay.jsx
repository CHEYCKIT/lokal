// Play on a cover, Spotify style: nothing over the artwork until it's
// hovered (or focused), then it darkens and a play glyph shows. The whole
// cover is the button.

import React from 'react'

/** A play triangle with rounded corners (no circle behind it). */
export function PlayGlyph({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M7.5 4.95v14.1a1.2 1.2 0 0 0 1.83 1.02l11.3-7.05a1.2 1.2 0 0 0 0-2.04L9.33 3.93A1.2 1.2 0 0 0 7.5 4.95Z" fill="currentColor" />
    </svg>
  )
}

/** Fills its (relative) parent: put it over the cover image. */
export default function CoverPlay({ label, onPlay, rounded = '' }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => { event.stopPropagation(); onPlay?.() }}
      className={`group/play absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 outline-none transition duration-200 hover:bg-black/45 hover:opacity-100 focus-visible:bg-black/45 focus-visible:opacity-100 ${rounded}`}
    >
      <PlayGlyph className="h-12 w-12 scale-90 drop-shadow-[0_4px_14px_rgba(0,0,0,0.6)] transition-transform duration-200 group-hover/play:scale-100 group-active/play:scale-90" />
    </button>
  )
}
