import { useCallback, useEffect, useRef } from 'react'

export const VOLUME_WHEEL_STEP = 0.05

/** The volume after one wheel notch: up raises it, down lowers it, kept within 0–1. */
export function wheelVolume(volume, deltaY) {
  const next = (Number(volume) || 0) - VOLUME_WHEEL_STEP * Math.sign(deltaY || 0)
  return Math.round(Math.min(1, Math.max(0, next)) * 100) / 100
}

/**
 * A ref for a volume slider so the mouse wheel over it changes the volume
 * instead of scrolling the page. Attached natively: React's onWheel is
 * passive, so preventDefault there wouldn't stop the scroll.
 */
export function useVolumeWheel(volume, setVolume) {
  const latest = useRef({ volume, setVolume })
  latest.current = { volume, setVolume }
  const cleanup = useRef(null)
  useEffect(() => () => cleanup.current?.(), [])
  return useCallback((element) => {
    cleanup.current?.()
    cleanup.current = null
    if (!element) return
    const onWheel = (event) => {
      if (!event.deltaY) return
      event.preventDefault()
      const { volume: current, setVolume: set } = latest.current
      set(wheelVolume(current, event.deltaY))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    cleanup.current = () => element.removeEventListener('wheel', onWheel)
  }, [])
}
