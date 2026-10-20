
import { useSyncExternalStore } from 'react'

const KEY = 'lokal-tv-mode'
const AUTO_TOUCH_QUERY = '(pointer: coarse) and (hover: none)'
const modeListeners = new Set()
const activeListeners = new Set()

function readMode() {
  try {
    return localStorage.getItem(KEY) || 'auto'
  } catch {
    return 'auto'
  }
}

let mode = typeof window !== 'undefined' ? readMode() : 'off'

function notify() {
  new Set([...modeListeners, ...activeListeners]).forEach(listener => listener())
}

export function getTvMode() {
  return mode
}

function hasConnectedGamepad() {
  try {
    return Array.from(navigator.getGamepads?.() || []).some(pad => pad?.connected === true)
  } catch {
    return false
  }
}

function hasTouchFirstPointer() {
  try {
    return typeof window !== 'undefined' &&
      !!window.matchMedia?.(AUTO_TOUCH_QUERY).matches
  } catch {
    return false
  }
}

/** Shared automatic-mode rule: connected gamepad or touch-first device. */
export function resolveTvMode(selectedMode = mode) {
  if (selectedMode === 'on') return true
  if (selectedMode !== 'auto') return false
  return hasConnectedGamepad() || hasTouchFirstPointer()
}

function subscribeMode(listener) {
  modeListeners.add(listener)
  return () => modeListeners.delete(listener)
}

function subscribeActive(listener) {
  activeListeners.add(listener)
  if (typeof window === 'undefined') {
    return () => activeListeners.delete(listener)
  }

  const notifyEnvironmentChange = () => listener()
  window.addEventListener('gamepadconnected', notifyEnvironmentChange)
  window.addEventListener('gamepaddisconnected', notifyEnvironmentChange)

  let mediaQuery = null
  try {
    mediaQuery = window.matchMedia?.(AUTO_TOUCH_QUERY) || null
    mediaQuery?.addEventListener?.('change', notifyEnvironmentChange)
    // Safari/Electron compatibility with older MediaQueryList implementations.
    if (mediaQuery && !mediaQuery.addEventListener) {
      mediaQuery.addListener?.(notifyEnvironmentChange)
    }
  } catch {}

  return () => {
    activeListeners.delete(listener)
    window.removeEventListener('gamepadconnected', notifyEnvironmentChange)
    window.removeEventListener('gamepaddisconnected', notifyEnvironmentChange)
    try {
      mediaQuery?.removeEventListener?.('change', notifyEnvironmentChange)
      if (mediaQuery && !mediaQuery.removeEventListener) {
        mediaQuery.removeListener?.(notifyEnvironmentChange)
      }
    } catch {}
  }
}

export function setTvMode(value) {
  if (!['auto', 'on', 'off'].includes(value)) return

  mode = value

  try {
    localStorage.setItem(KEY, value)
  } catch {}

  // TV-mode CSS is owned by TvController, which derives it from this same resolver.
  notify()
}

export function useTvMode() {
  return useSyncExternalStore(subscribeMode, getTvMode, () => 'off')
}

export function useTvModeActive() {
  return useSyncExternalStore(subscribeActive, () => resolveTvMode(mode), () => false)
}
