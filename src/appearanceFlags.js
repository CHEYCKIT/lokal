// On/off appearance settings read outside the Settings page (the player bar,
// the app layout). Read once and shared; re-read whenever settings are saved,
// so a switch applies straight away. A setting is on unless it's '0'.
//   glass_player_bar   Settings > Appearance > Player Bar > Glass
//   player_waveform    Settings > Appearance > Player Bar > Waveform

import { useEffect, useState } from 'react'
import { api } from './api'

const KEYS = ['glass_player_bar', 'player_waveform']
let values = Object.fromEntries(KEYS.map(key => [key, true]))
let load = null
const listeners = new Set()

function refresh() {
  load = Promise.resolve(api.getSettings?.())
    .then(s => { if (s && !s.error) values = Object.fromEntries(KEYS.map(key => [key, s[key] !== '0'])) })
    .catch(() => {})
    .then(() => listeners.forEach(fn => fn(values)))
  return load
}
if (typeof window !== 'undefined') window.addEventListener('lokal:settings-saved', refresh)

/** true unless the appearance setting `key` has been switched off. */
export function useAppearanceFlag(key) {
  const [on, setOn] = useState(values[key])
  useEffect(() => {
    const update = next => setOn(next[key])
    listeners.add(update)
    if (!load) refresh()
    else load.then(() => setOn(values[key]))
    return () => { listeners.delete(update) }
  }, [key])
  return on
}
