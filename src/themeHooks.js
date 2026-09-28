import { useState, useEffect, useRef } from 'react'
import { api } from './api'
import { THEMES, applyTheme } from './theme'

const PERSISTENT_THEME_OVERRIDE_KEYS = [
  '--bg-image',
  '--bg-overlay',
  '--bg-blur',
  '--bg-size',
  '--bg-position',
  '--logo-image-filter',
  '--logo-image-opacity',
  '--logo-mask-opacity',
  '--logo-wrap-bg',
  '--logo-wrap-shadow',
  '--logo-wrap-border',
]

// Theme saves go out one after another, in the order they were made, so a
// quick run of changes (dragging the blur slider, clicking through accents)
// can't land out of order and leave an older value saved. Module scope so it
// survives Settings remounting.
let themeSaveChain = Promise.resolve()
function persistTheme(name, overrides) {
  themeSaveChain = themeSaveChain
    .catch(() => {})
    .then(() => api.saveTheme(name, overrides))
    .then(r => { if (r?.error) throw new Error(r.error) })
  return themeSaveChain.catch(e => { console.warn('[theme] save failed:', e?.message || e) })
}

export function useTheme() {
  const [themeName, setThemeName] = useState('dark')
  const [themeOverrides, setThemeOverrides] = useState({})
  const [showAdvanced, setShowAdvanced] = useState(false)
  // The scale already applied at startup, so the picker doesn't show 1x first.
  const [textScale, setTextScaleState] = useState(() => {
    try { return document.documentElement.style.getPropertyValue('--text-scale').trim() || '1' } catch { return '1' }
  })
  // The latest theme, readable right away (state only updates on the next
  // render, so two quick changes would otherwise both start from the old one).
  const current = useRef({ name: 'dark', overrides: {} })
  // Set once the user changes anything: the saved theme loading late must
  // not undo that change on screen.
  const touched = useRef(false)
  const loaded = useRef(null)

  const commit = (name, overrides) => {
    touched.current = true
    current.current = { name, overrides }
    setThemeName(name)
    setThemeOverrides(overrides)
    applyTheme({ ...(THEMES[name]?.vars || THEMES.dark.vars), ...overrides })
    return persistTheme(name, overrides)
  }

  useEffect(() => {
    // Both desktop and web mode (web used to skip this, so changing the
    // accent there saved it on top of the default theme).
    loaded.current = Promise.resolve(api.getTheme?.()).then(t => {
      if (!t || t.error || touched.current) return
      const name = t.theme || 'dark'
      const overrides = t.overrides || {}
      current.current = { name, overrides }
      setThemeName(name)
      setThemeOverrides(overrides)
      applyTheme({ ...(THEMES[name]?.vars || THEMES.dark.vars), ...overrides })
      const textScaleValue = overrides['--text-scale'] || '1'
      setTextScaleState(textScaleValue)
      document.documentElement.style.setProperty('--text-scale', textScaleValue)
    }).catch(() => {})
  }, [])

  // A change made before the saved theme has loaded builds on the saved one,
  // not on the placeholder "dark" defaults.
  const whenLoaded = async (fn) => { await loaded.current; return fn(current.current) }

  const selectTheme = (name) => whenLoaded(({ overrides }) => {
    const preserved = Object.fromEntries(Object.entries(overrides).filter(([key]) => PERSISTENT_THEME_OVERRIDE_KEYS.includes(key) || key === '--text-scale'))
    return commit(name, preserved)
  })

  const setAccent = (accentColor) => whenLoaded(({ name, overrides }) =>
    commit(name, { ...overrides, '--accent': accentColor.value, '--accent-dim': accentColor.dim }))

  const saveOverride = (key, value) => whenLoaded(({ name, overrides }) => commit(name, { ...overrides, [key]: value }))

  const saveOverrides = (patch) => whenLoaded(({ name, overrides }) => commit(name, { ...overrides, ...patch }))

  const resetTheme = () => whenLoaded(({ name, overrides }) =>
    commit(name, overrides['--text-scale'] ? { '--text-scale': overrides['--text-scale'] } : {}))

  const setTextScale = (scale) => {
    setTextScaleState(scale)
    return whenLoaded(({ name, overrides }) => commit(name, { ...overrides, '--text-scale': scale }))
  }

  return {
    themeName, setThemeName,
    themeOverrides,
    showAdvanced, setShowAdvanced,
    selectTheme, setAccent, saveOverride, saveOverrides, resetTheme,
    textScale, setTextScale
  }
}
