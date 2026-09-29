import React, { useContext, useEffect, useLayoutEffect, useRef } from 'react'
import { PageShownContext } from '../pageCache'

// The artwork's own hover zoom (Tailwind transition-transform duration-300)
// has to survive the inline transition, which would otherwise replace it.
const HOVER = 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)'
const FADE = `opacity 200ms ease-out, ${HOVER}`

/** Resolves once the image is decoded, or right away where it can't tell. */
function decoded(img) {
  if (typeof img.decode !== 'function') return Promise.resolve()
  return Promise.resolve().then(() => img.decode()).catch(() => {})
}

/**
 * Artwork <img> for grids: decoded off the main thread and only when near the
 * viewport, then faded in once it's ready to paint. Decoding dozens of
 * full-size covers synchronously is what made image-heavy pages drop frames
 * while they faded in. A cover that's ready while its page is still fading in
 * waits for that fade to end (its own fade would share those frames); one
 * that's already decoded (a page seen before) shows at once. A new `src`
 * starts over: hidden, then faded in when that image is ready.
 */
export default function FadeImg({ src, style, onLoad, ...props }) {
  const ref = useRef(null)
  const ready = useRef(false)
  const pageShown = useContext(PageShownContext)
  const pageShownRef = useRef(pageShown)
  pageShownRef.current = pageShown

  const reveal = () => { if (ref.current) ref.current.style.opacity = '1' }

  // Per source: start hidden with the fade on; a source that's already
  // loaded (cached from an earlier visit) shows at once once decoded.
  useLayoutEffect(() => {
    const img = ref.current
    ready.current = false
    if (!img) return
    img.style.transition = FADE
    img.style.opacity = '0'
    if (!(img.complete && img.naturalWidth)) return
    let current = true
    decoded(img).then(() => {
      if (!current || ref.current !== img) return
      ready.current = true
      img.style.transition = HOVER
      img.style.opacity = '1'
      // Fade back on for any later change (the hover zoom keeps its own).
      requestAnimationFrame(() => { if (ref.current === img) img.style.transition = FADE })
    })
    return () => { current = false }
  }, [src])

  useEffect(() => {
    if (pageShown && ready.current) reveal()
  }, [pageShown])

  return (
    <img
      ref={ref}
      loading="lazy"
      decoding="async"
      alt=""
      src={src}
      {...props}
      style={{ opacity: 0, transition: FADE, ...style }}
      onLoad={(event) => {
        const img = event.currentTarget
        const loadedSrc = img.currentSrc || img.src
        // Revealed only once decoded (never while blank), and only if it's
        // still the image this element shows; a failed decode still shows it.
        decoded(img).then(() => {
          if (ref.current !== img || (img.currentSrc || img.src) !== loadedSrc) return
          ready.current = true
          if (pageShownRef.current) reveal()
        })
        onLoad?.(event)
      }}
    />
  )
}
