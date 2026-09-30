// Pages lay out by the width they're actually given (the space between the
// sidebars), not the window's: with the right sidebar open, or a small
// window, a page switches to its narrower layout instead of spilling
// sideways.
//
// Tailwind's sm/md/lg/xl measure the window; @sm/@md/@lg/@xl (see
// tailwind.config.js) measure the page, at the window widths less the left
// sidebar (pageBreakpoints.js), so with the right sidebar closed a page looks
// exactly as before. The page element carries them as data-page="sm md lg",
// set here from its width, which the @ variants match. (Not a CSS container:
// that would make the page the containing block of everything fixed in it.)

import { useCallback, useRef } from 'react'
import { PAGE_BREAKPOINTS } from './pageBreakpoints'

/** The breakpoints `width` reaches, as data-page wants them ("sm md"). */
export function pageBreakpoints(width) {
  return Object.entries(PAGE_BREAKPOINTS).filter(([, min]) => width >= min).map(([name]) => name).join(' ')
}

/** A ref for the page element that keeps its data-page in step with its width. */
export function usePageWidth() {
  const stop = useRef(null)
  return useCallback((el) => {
    stop.current?.()
    stop.current = null
    if (!el) return
    const update = () => {
      const next = pageBreakpoints(el.clientWidth)
      if (el.dataset.page !== next) el.dataset.page = next
    }
    update()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(el)
    window.addEventListener('resize', update)
    stop.current = () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [])
}
