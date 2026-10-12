// AutoMix's cover transition: when one song mixes into the next, the cover
// card turns a full circle around its vertical axis (a soft spring, in
// perspective) while the artwork dissolves into the next song's, like
// Octave's. For the side panel's and the full-screen player's covers, with
// AutoMix on and no moving cover playing (a video turning would be odd).

import { useRef } from 'react'
import { usePlayerStore } from '../store/player'

const SPIN = { type: 'spring', stiffness: 85, damping: 18 }

/**
 * Motion props for a cover card (a framer-motion element): { animate, transition, style }.
 * `still`: the cover shows its still artwork (no moving cover or canvas).
 */
export function useCoverFlip(still) {
  const flips = usePlayerStore(state => state.mixFlip || 0)
  const automix = usePlayerStore(state => !!state.crossfade?.automix)
  // Turns counted from when the cover appeared: opening the player mid-song doesn't spin it.
  const base = useRef(flips)
  const turns = automix && still ? flips - base.current : 0
  if (!automix || !still) base.current = flips
  return {
    animate: { rotateY: turns * 360 },
    transition: { rotateY: SPIN },
    style: { transformPerspective: 1400 },
  }
}
