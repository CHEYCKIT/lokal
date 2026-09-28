// Spotify-style search in the window header: a Home button, then the search
// box with a "play a random song" button where Spotify has Browse.
//
// - Focusing the box opens the Search page; its results follow the text live.
// - While the box is focused, past searches drop down under it: all of them
//   when it's empty, then only the closest matches as letters are typed.
// - Typing anywhere in the app (outside a text field, with nothing like the
//   fullscreen player or a dialog on top) starts a search; "/" or Ctrl/Cmd+K
//   just focus the box.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Clock, Home, Search as SearchIcon, Shuffle, X } from 'lucide-react'
import { useSearchStore } from '../store/search'
import { usePlayerStore } from '../store/player'
import { api } from '../api'
import {
  HISTORY_EVENT, clearRecentSearches, getRecentSearches, matchRecentSearches, removeRecentSearch, saveRecentSearch,
} from '../searchHistory'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')

function isTextField(el) {
  if (!el || el === document.body) return false
  if (el.isContentEditable) return true
  return !!el.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

/** Is the main app what's in front (no fullscreen player, dialog, onboarding...)? */
function appInFront() {
  const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
  if (!top || !top.closest('[data-app-layout]')) return false
  return !top.closest('.fixed, [role="dialog"], [aria-modal="true"]')
}

/** The typed text with the part matching `typed` emphasised. */
function Highlighted({ text, typed }) {
  const q = typed.trim().toLowerCase()
  const at = q ? text.toLowerCase().indexOf(q) : -1
  if (at < 0) return <span className="text-text/80">{text}</span>
  return (
    <span className="text-text/60">
      {text.slice(0, at)}
      <span className="text-text font-medium">{text.slice(at, at + q.length)}</span>
      {text.slice(at + q.length)}
    </span>
  )
}

export default function HeaderSearch() {
  const nav = useNavigate()
  const loc = useLocation()
  const query = useSearchStore(s => s.query)
  const setQuery = useSearchStore(s => s.setQuery)
  const focusSeq = useSearchStore(s => s.focusSeq)
  const requestFocus = useSearchStore(s => s.requestFocus)
  const playQueue = usePlayerStore(s => s.playQueue)

  const inputRef = useRef(null)
  const [focused, setFocused] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [history, setHistory] = useState(getRecentSearches)
  const [active, setActive] = useState(-1)
  const [randomLoading, setRandomLoading] = useState(false)

  const onSearchPage = loc.pathname === '/search'
  const onHome = loc.pathname === '/'

  // History can change from the Search page (a result opened) or elsewhere.
  useEffect(() => {
    const refresh = () => setHistory(getRecentSearches())
    window.addEventListener(HISTORY_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(HISTORY_EVENT, refresh); window.removeEventListener('storage', refresh) }
  }, [])

  // Leaving the Search page empties the box, like Spotify.
  useEffect(() => {
    if (!onSearchPage) { setQuery(''); setDropdownOpen(false) }
  }, [onSearchPage, setQuery])

  // Someone asked for the box (typing anywhere, "/", Ctrl+K).
  useEffect(() => {
    if (!focusSeq) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    const end = input.value.length
    try { input.setSelectionRange(end, end) } catch {}
  }, [focusSeq])

  const suggestions = useMemo(() => matchRecentSearches(history, query), [history, query])
  useEffect(() => { setActive(-1) }, [query, dropdownOpen])

  const openSearchPage = useCallback(() => {
    if (loc.pathname !== '/search') nav('/search')
  }, [nav, loc.pathname])

  // Typing anywhere starts a search.
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing) return
      const altGraph = e.getModifierState?.('AltGraph')
      if ((e.key === 'k' || e.key === 'K') && (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        openSearchPage()
        requestFocus()
        inputRef.current?.select()
        return
      }
      if ((e.ctrlKey || e.metaKey || e.altKey) && !altGraph) return
      if (e.key.length !== 1 || /\s/.test(e.key)) return
      if (isTextField(e.target) || isTextField(document.activeElement)) return
      if (!appInFront()) return
      e.preventDefault()
      openSearchPage()
      if (e.key === '/') { requestFocus(); return }
      const { query: current, setQuery: set } = useSearchStore.getState()
      // On the Search page it adds to what's there; elsewhere it's a new search.
      set((loc.pathname === '/search' ? current : '') + e.key)
      requestFocus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSearchPage, requestFocus, loc.pathname])

  const pick = (entry) => {
    setQuery(entry.query)
    saveRecentSearch(entry.query)
    setDropdownOpen(false)
    openSearchPage()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggestions.length) return
      e.preventDefault()
      setDropdownOpen(true)
      const step = e.key === 'ArrowDown' ? 1 : -1
      const n = suggestions.length
      // -1 is the text box itself; wrap around through the list.
      setActive(i => { let next = i + step; if (next >= n) next = -1; if (next < -1) next = n - 1; return next })
      return
    }
    if (e.key === 'Enter') {
      if (dropdownOpen && active >= 0 && suggestions[active]) { e.preventDefault(); pick(suggestions[active]); return }
      if (query.trim()) saveRecentSearch(query)
      setDropdownOpen(false)
      return
    }
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (dropdownOpen && suggestions.length) setDropdownOpen(false)
      else if (query) setQuery('')
      else inputRef.current?.blur()
    }
  }

  const playRandom = async () => {
    if (randomLoading) return
    setRandomLoading(true)
    try {
      const track = await api.getRandomTrack()
      if (track && !track.error) playQueue([track], 0)
    } finally {
      setRandomLoading(false)
    }
  }

  const showDropdown = focused && dropdownOpen && suggestions.length > 0

  return (
    <div className="flex items-center gap-2 min-w-0 w-full justify-center" style={{ WebkitAppRegion: 'no-drag' }}>
      <button
        onClick={() => nav('/')}
        title="Home"
        aria-label="Home"
        className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-colors bg-elevated hover:bg-card ${onHome ? 'text-text' : 'text-muted hover:text-text'}`}
      >
        <Home size={22} strokeWidth={onHome ? 2.4 : 1.8} />
      </button>

      <div className="relative min-w-0" style={{ flex: '0 1 474px' }} data-tour="search">
        <div
          className={`group h-12 flex items-center rounded-full bg-elevated border transition-colors ${focused ? 'border-accent/60' : 'border-transparent hover:border-border2 hover:bg-card'}`}
          onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus() } }}
        >
          <SearchIcon size={20} className={`ml-3.5 mr-2 flex-shrink-0 ${focused ? 'text-text' : 'text-muted group-hover:text-text'}`} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true); openSearchPage() }}
            onFocus={() => { setFocused(true); setDropdownOpen(true); openSearchPage() }}
            onBlur={() => { setFocused(false); setDropdownOpen(false); if (query.trim().length >= 2 && onSearchPage) saveRecentSearch(query) }}
            onKeyDown={onKeyDown}
            placeholder="What do you want to play?"
            spellCheck={false}
            aria-label="Search your library"
            aria-expanded={showDropdown}
            aria-controls="header-search-history"
            aria-activedescendant={active >= 0 ? `header-search-history-${active}` : undefined}
            className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-text placeholder:text-muted"
          />
          {query && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              title="Clear search"
              aria-label="Clear search"
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-text"
            >
              <X size={18} />
            </button>
          )}
          <span className="flex-shrink-0 w-px h-6 bg-border2 mx-1" />
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={playRandom}
            disabled={randomLoading}
            title="Play a random song"
            aria-label="Play a random song"
            className="flex-shrink-0 w-10 h-10 mr-1 rounded-full flex items-center justify-center text-muted hover:text-text disabled:opacity-60 transition-colors"
          >
            {randomLoading
              ? <span className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              : <Shuffle size={20} />}
          </button>
        </div>

        <AnimatePresence>
          {showDropdown && (
            <motion.div
              id="header-search-history"
              role="listbox"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.12 }}
              onMouseDown={(e) => e.preventDefault()}
              className="absolute top-full left-0 right-0 mt-2 bg-elevated border border-border rounded-xl shadow-2xl z-50 overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                <span className="text-xs text-muted flex items-center gap-2">
                  <Clock size={11} /> {query.trim() ? 'Matching searches' : 'Recent searches'}
                </span>
                {!query.trim() && (
                  <button onClick={() => { clearRecentSearches(); setDropdownOpen(false) }} className="text-xs text-muted hover:text-text transition-colors">
                    Clear
                  </button>
                )}
              </div>
              <div className="py-1 max-h-80 overflow-y-auto">
                {suggestions.map((entry, i) => (
                  <div
                    key={entry.query}
                    id={`header-search-history-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(entry)}
                    className={`group/row flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors ${i === active ? 'bg-card' : ''}`}
                  >
                    <Clock size={13} className="text-muted flex-shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm"><Highlighted text={entry.query} typed={query} /></span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeRecentSearch(entry.query) }}
                      title="Remove from history"
                      aria-label={`Remove ${entry.query} from history`}
                      className="opacity-0 group-hover/row:opacity-100 w-6 h-6 rounded-full flex items-center justify-center text-muted hover:text-text"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
