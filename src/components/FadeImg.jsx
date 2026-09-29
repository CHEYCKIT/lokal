import React, { useContext, useEffect, useLayoutEffect, useRef } from 'react'
import { PageShownContext } from '../pageCache'

/**
 * Artwork <img> for grids: decoded off the main thread and only when near the
 * viewport, then faded in once it's ready. Decoding dozens of full-size
 * covers synchronously is what made image-heavy pages drop frames while they
 * faded in. A cover that loads while its page is still fading in waits for
 * that fade to end (its own fade would share those frames); one that's
 * already decoded (a page seen before) shows at once.
 */
export default function FadeImg({ style, onLoad, ...props }) {
  const ref = useRef(null)
  const loaded = useRef(false)
  const pageShown = useContext(PageShownContext)
  const pageShownRef = useRef(pageShown)
  pageShownRef.current = pageShown

  const reveal = () => { if (ref.current) ref.current.style.opacity = '1' }

  // Already decoded (cached from an earlier visit): no fade, no wait.
  useLayoutEffect(() => {
    const img = ref.current
    if (img?.complete && img.naturalWidth) {
      loaded.current = true
      img.style.transition = 'none'
      img.style.opacity = '1'
    }
  }, [])

  useEffect(() => {
    if (pageShown && loaded.current) reveal()
  }, [pageShown])

  return (
    <img
      ref={ref}
      loading="lazy"
      decoding="async"
      alt=""
      {...props}
      style={{ opacity: 0, transition: 'opacity 200ms ease-out', ...style }}
      onLoad={(event) => {
        loaded.current = true
        if (pageShownRef.current) reveal()
        onLoad?.(event)
      }}
    />
  )
}
