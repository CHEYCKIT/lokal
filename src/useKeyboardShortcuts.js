// App-wide keyboard shortcuts (issue #425). Letters go with Ctrl (Cmd on a
// Mac): a plain letter already starts a search (HeaderSearch). Not while
// typing in a field. KEYBOARD_SHORTCUTS is what Settings lists.
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from './store/player'

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
const MOD = isMac ? '⌘' : 'Ctrl'

export const KEYBOARD_SHORTCUTS = [
  { keys: ['Space'], label: 'Play / pause' },
  { keys: [MOD, '→'], label: 'Next song' },
  { keys: [MOD, '←'], label: 'Previous song' },
  { keys: ['Shift', '→'], label: 'Forward 10 seconds' },
  { keys: ['Shift', '←'], label: 'Back 10 seconds' },
  { keys: [MOD, '↑'], label: 'Volume up' },
  { keys: [MOD, '↓'], label: 'Volume down' },
  { keys: [MOD, 'S'], label: 'Shuffle on / off' },
  { keys: [MOD, 'L'], label: 'Lyrics' },
  { keys: [MOD, 'F'], label: 'Full-screen player' },
  { keys: [MOD, 'K'], label: 'Search' },
  { keys: [MOD, ','], label: 'Settings' },
]

function isTextField(el) {
  if (!el || el === document.body) return false
  if (el.isContentEditable) return true
  return !!el.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate()
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing || e.altKey) return
      if (isTextField(e.target) || isTextField(document.activeElement)) return
      const mod = isMac ? e.metaKey : e.ctrlKey
      const other = isMac ? e.ctrlKey : e.metaKey
      if (other) return
      const player = usePlayerStore.getState()
      let run = null
      if (!mod && !e.shiftKey && e.code === 'Space') {
        // Also when a button has focus: Space would click it again instead.
        run = () => player.togglePlay()
      } else if (!mod && e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        if (!player.currentTrack) return
        const step = e.key === 'ArrowRight' ? 10 : -10
        run = () => {
          const { progress, duration } = usePlayerStore.getState()
          const max = duration > 0 ? Math.max(0, duration - 1) : Infinity
          usePlayerStore.getState().setProgressWithAudioUpdate(Math.min(max, Math.max(0, progress + step)))
        }
      } else if (mod && !e.shiftKey) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
        if (key === 'ArrowRight') run = () => player.next()
        else if (key === 'ArrowLeft') run = () => player.prev()
        else if (key === 'ArrowUp' || key === 'ArrowDown') {
          const volume = Math.min(1, Math.max(0, Math.round(((player.volume ?? 1) + (key === 'ArrowUp' ? 0.1 : -0.1)) * 10) / 10))
          run = () => player.setVolume(volume)
        }
        else if (key === 's') run = () => player.toggleShuffle()
        else if (key === 'l') run = () => player.toggleLyricsButton()
        else if (key === 'f') run = () => player.toggleFullscreen()
        else if (key === ',') run = () => navigate('/settings')
      }
      if (!run) return
      e.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])
}
