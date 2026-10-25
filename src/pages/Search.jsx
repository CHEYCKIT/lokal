import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Music, Disc3, Clock, User, Play, Search as SearchIcon } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../store/player'
import { useShallow } from 'zustand/react/shallow'
import { useSearchStore } from '../store/search'
import { SEARCH_SCOPES, searchesLibrary, searchesOnline, scopeDescription } from '../searchScope.mjs'
import { SEARCH_RESULT_CATEGORIES, includesResultCategory, categoryLabel } from '../searchResultCategory.mjs'
import TrackList from '../components/TrackList'
import OnlineResults from '../components/OnlineResults'
import GlobalCatalogueResults from '../components/GlobalCatalogueResults'
import LinkDownload from '../components/LinkDownload'
import { api } from '../api'
import { HISTORY_EVENT, getRecentItems, saveRecentItem, saveRecentSearch } from '../searchHistory'
import { isStreamed } from '../onlineTracks'
import { asLink } from '../downloadLinks'
import { useTranslation } from '../i18n'

// Results for what's typed in the header search box (HeaderSearch.jsx); with
// nothing typed, the things recently opened from a search. It's also where
// music is found to download: online results (YouTube Music, SoundCloud,
// addons, Soulseek) save to the library, and a pasted link downloads.
/** The Search page: results for the header query, or recently opened items when it's empty. */
export default function Search() {
  const { t } = useTranslation()
  const query = useSearchStore(s => s.query)
  const setQuery = useSearchStore(s => s.setQuery)
  const scope = useSearchStore(s => s.scope)
  const setScope = useSearchStore(s => s.setScope)
  const resultCategory = useSearchStore(s => s.resultCategory)
  const setResultCategory = useSearchStore(s => s.setResultCategory)
  const showSongs = includesResultCategory(resultCategory, 'songs')
  const showArtists = includesResultCategory(resultCategory, 'artists')
  const showAlbums = includesResultCategory(resultCategory, 'albums')
  const showLibrary = searchesLibrary(scope)
  const showOnline = searchesOnline(scope)
  // A source search from a streamed song or a lossless request. The selected
  // source receives the same query and can replace the original ghost track.
  const location = useLocation()
  const [soulseekFor, setSoulseekFor] = useState(null)
  const [findOnRequest, setFindOnRequest] = useState(null)
  useEffect(() => {
    const legacySoulseek = location.state?.soulseek
    const request = location.state?.findOn || (legacySoulseek ? { ...legacySoulseek, provider: 'slsk' } : null)
    setFindOnRequest(request)
    setSoulseekFor(request?.provider === 'slsk' ? request : null)
    if (request) {
      // Explicitly invoking Find on a provider must show those results,
      // even if the saved scope is Library.
      searchSeqRef.current++
      setScope('online')
      setResultCategory('songs')
      setQuery(request.query || '')
    }
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps
  const [tracks, setTracks] = useState([])
  const [artists, setArtists] = useState([])
  const [albums, setAlbums] = useState([])
  const [lyricMatches, setLyricMatches] = useState([])
  const [searching, setSearching] = useState(false)
  const [recentItems, setRecentItems] = useState(getRecentItems)
  const recentTrackSelectionRef = useRef(0)
  const searchSeqRef = useRef(0)
  // A misspelt search ("micheal jackson") is searched corrected, Spotify-like:
  // { from, to } while it is. The online sources get the corrected query too.
  // "Search for ... instead" searches the text as typed (exactRef).
  const [correction, setCorrection] = useState(null)
  const [onlineQuery, setOnlineQuery] = useState(query)
  const exactRef = useRef('')
  const nav = useNavigate()
  const { playQueue, playTrack } = usePlayerStore(useShallow(({ playQueue, playTrack }) => ({ playQueue, playTrack })))
  const isSearchStarted = !!query.trim()
  // A pasted link isn't searched for: it's offered for download.
  const link = asLink(query)

  useEffect(() => {
    const refresh = () => setRecentItems(getRecentItems())
    window.addEventListener(HISTORY_EVENT, refresh)
    return () => window.removeEventListener(HISTORY_EVENT, refresh)
  }, [])

  /** Search tracks, albums and lyrics for `q`; results from an outdated search are ignored. */
  const doSearch = useCallback(async (q) => {
    const seq = ++searchSeqRef.current
    if (!q.trim()) { setTracks([]); setArtists([]); setAlbums([]); setLyricMatches([]); setSearching(false); setCorrection(null); setOnlineQuery(''); return }
    if (!showLibrary) {
      // Source scope is authoritative: do not query the local DB in Online
      // mode or leave previous Library results visible when switching.
      setTracks([]); setArtists([]); setAlbums([]); setLyricMatches([])
      setCorrection(null); setOnlineQuery(q); setSearching(false)
      return
    }
    setSearching(true)
    let res, albumRes, lyricsRes
    const searchLibrary = text => Promise.all([api.searchTracks(text), api.searchAlbums(text), api.searchLyrics(text)])
    try {
      ;[res, albumRes, lyricsRes] = await searchLibrary(q)
      const found = (Array.isArray(res) ? res : res?.tracks || []).length || (res?.artists || []).length || (Array.isArray(albumRes) ? albumRes : []).length
      let corrected = null
      // Nothing as typed: maybe a typo. Corrected the library's way (or YouTube Music's).
      if (!found && exactRef.current !== q.trim()) {
        const spelling = await Promise.resolve(api.searchSpelling?.(q)).catch(() => null)
        if (seq !== searchSeqRef.current) return
        corrected = spelling?.corrected || null
        if (corrected) [res, albumRes, lyricsRes] = await searchLibrary(corrected)
      }
      if (seq !== searchSeqRef.current) return
      setCorrection(corrected ? { from: q.trim(), to: corrected } : null)
      setOnlineQuery(corrected || q)
    } catch (error) {
      // Only the latest search may change what's shown.
      if (seq !== searchSeqRef.current) return
      console.warn('[search] Search failed:', error)
      setTracks([]); setArtists([]); setAlbums([]); setLyricMatches([])
      setSearching(false)
      return
    }
    // Typing on: a newer search has started, so these results are stale.
    if (seq !== searchSeqRef.current) return
    if (res?.artists) { setArtists(res.artists || []); setTracks(res.tracks || []) }
    else { setArtists([]); setTracks(Array.isArray(res) ? res : []) }
    setAlbums(Array.isArray(albumRes) ? albumRes : [])
    setLyricMatches(Array.isArray(lyricsRes) ? lyricsRes : [])
    setSearching(false)
  }, [showLibrary])

  // Results follow the text as it's typed. A new query makes any search
  // still in flight stale straight away, not only when the debounce ends.
  useEffect(() => {
    if (!query.trim() || link) { doSearch(''); return }
    searchSeqRef.current++
    setSearching(showLibrary)
    const t = setTimeout(() => doSearch(query), 200)
    return () => clearTimeout(t)
  }, [query, link, doSearch, showLibrary])

  useEffect(() => {
    const handleRefresh = () => {
      if (showLibrary && query.trim() && !asLink(query)) {
        doSearch(query)
      }
      setRecentItems(getRecentItems())
    }
    window.addEventListener('lokal:refresh', handleRefresh)
    return () => window.removeEventListener('lokal:refresh', handleRefresh)
  }, [query, doSearch, showLibrary])

  const artSrc = (a) => a.image_path ? (api.isElectron ? `file://${a.image_path}` : null) : null
  // By the album's cover track in the web app (an album has no id of its own).

  /** Open an artist from the results and remember it. */
  const handleArtistClick = (artist) => {
    saveRecentSearch(artist.name)
    saveRecentItem({ 
      id: artist.id, 
      name: artist.name, 
      image_path: artist.image_path,
      type: 'artist'
    })
    nav(`/artist/${artist.id}`)
  }

  /** Open an album from the results and remember it. */
  const handleAlbumClick = (album) => {
    saveRecentSearch(album.title)
    saveRecentItem({
      id: album.title,
      title: album.title,
      artwork_path: album.artwork_path,
      artwork_track_id: album.artwork_track_id,
      track_count: album.track_count,
      year: album.year,
      type: 'album'
    })
    nav('/albums', { state: { album } })
  }

  /** A recent song as a playable track (null if it's gone from the library). */
  const recentTrack = async (item) => {
    // A song streamed from search: the item has what it takes to stream it again.
    if (item.file_path && isStreamed(item)) {
      return { id: item.id, title: item.name, artist: item.artist, album: item.album, file_path: item.file_path, source_url: item.source_url, artwork_url: item.artwork_url, duration: item.duration }
    }
    try {
      const matches = await api.getTracks({ id: item.id, limit: 1 })
      return Array.isArray(matches) ? matches[0] || null : null
    } catch (error) {
      console.error('Failed to load recent track', error)
      return null
    }
  }

  /** Reopen a recent item: an artist or album page, or play a track. */
  const handleRecentItemClick = async (item) => {
    if (item.type === 'artist') {
      nav(`/artist/${item.id}`)
    } else if (item.type === 'track') {
      // The recent songs play as a list, in the order shown, from the one
      // clicked (Previous goes back up it). On its own, autoplay followed the
      // song with unrelated library songs.
      const selectionId = ++recentTrackSelectionRef.current
      const items = visibleRecentItems.filter(entry => entry.type === 'track')
      const tracks = await Promise.all(items.map(recentTrack))
      if (selectionId !== recentTrackSelectionRef.current) return
      const list = []
      let start = -1
      items.forEach((entry, i) => {
        if (!tracks[i]) return
        if (entry.id === item.id) start = list.length
        list.push(tracks[i])
      })
      if (start >= 0) playQueue(list, start, { type: 'search', name: 'Recent' })
    } else if (item.type === 'album') {
      nav('/albums', { state: { album: item } })
    }
  }

  /** Play a track found by its lyrics and remember it. */
  const handleLyricMatchPlay = (track) => {
    saveRecentSearch(query.trim())
    saveRecentItem({
      id: track.id,
      name: track.title,
      artist: track.artist,
      artwork_path: track.artwork_path,
      type: 'track',
    })
    playTrack(track, [track])
  }

  // Source scope and result type are orthogonal, like mobile.
  const hasVisibleLibraryResults = (showSongs && (tracks.length || lyricMatches.length)) ||
    (showArtists && artists.length) || (showAlbums && albums.length)
  // Recents are local navigational history; don't leak them into Online-only
  // search, and don't show streams while explicitly searching only Library.
  const visibleRecentItems = scope === 'online' ? [] : recentItems.filter(item => {
    if (scope === 'library' && item.type === 'track' && isStreamed(item)) return false
    return resultCategory === 'all' ||
      (resultCategory === 'songs' && item.type === 'track') ||
      (resultCategory === 'artists' && item.type === 'artist') ||
      (resultCategory === 'albums' && item.type === 'album')
  })
  const showSearchResults = isSearchStarted

  return (
    <div className="p-6 space-y-6 pb-10">
      <div className="flex flex-col items-start gap-2">
        <div role="group" aria-label={t('Search sources')}
          className="inline-flex max-w-full items-center rounded-xl border border-border bg-elevated/50 p-1 gap-1">
          {SEARCH_SCOPES.map(value => (
            <button key={value} type="button"
              onClick={() => {
                if (value !== scope) {
                  searchSeqRef.current++
                  setCorrection(null)
                  setOnlineQuery(query)
                }
                setScope(value)
              }}
              aria-pressed={scope === value}
              title={t(scopeDescription(value))}
              className={`min-w-[5.25rem] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${scope === value ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white hover:bg-card'}`}>
              {t(value === 'all' ? 'All' : value === 'library' ? 'Library' : 'Online')}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted">{t(scopeDescription(scope))}</p>
        <div role="group" aria-label={t('Search result type')}
          className="flex max-w-full flex-wrap items-center gap-1">
          {SEARCH_RESULT_CATEGORIES.map(value => (
            <button key={value} type="button"
              onClick={() => setResultCategory(value)}
              aria-pressed={resultCategory === value}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${resultCategory === value ? 'bg-accent/20 border-accent/40 text-accent' : 'border-border bg-elevated/50 text-muted hover:text-white hover:bg-card'}`}>
              {t(categoryLabel(value))}
            </button>
          ))}
        </div>
      </div>
      {!showSearchResults && (
        <div className="space-y-6">
          {visibleRecentItems.length > 0 && (
            <section>
              <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3 flex items-center gap-2">
                <Clock size={12} /> Recent
              </h2>
              <div className="grid grid-cols-3 @sm:grid-cols-5 gap-3">
                {visibleRecentItems.map((item, i) => (
                  <motion.button
                    key={`${item.id}-${i}`}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(i, 10) * 0.03 }}
                    onClick={() => handleRecentItemClick(item)}
                    className="flex flex-col items-center gap-2 group min-w-0"
                  >
                    <div className="w-full aspect-square rounded-xl bg-elevated border border-border overflow-hidden flex items-center justify-center text-muted group-hover:border-accent/40 transition-colors relative">
                      {item.type === 'artist' ? (
                        artSrc(item) ? (
                          <img src={artSrc(item)} className="w-full h-full object-cover" />
                        ) : (
                          <User size={20} />
                        )
                      ) : item.type === 'album' ? (
                        api.albumArtURL(item) ? (
                          <img src={api.albumArtURL(item)} className="w-full h-full object-cover" />
                        ) : (
                          <Disc3 size={20} />
                        )
                      ) : (
                        item.artwork_path ? (
                          <img src={api.isElectron ? `file://${item.artwork_path}` : api.artworkURL(item.id)} className="w-full h-full object-cover" />
                        ) : item.artwork_url ? (
                          <img src={item.artwork_url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <Music size={20} />
                        )
                      )}
                      {item.type === 'track' && (
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Play size={16} fill="currentColor" className="text-white" />
                        </div>
                      )}
                    </div>
                    <div className="text-center w-full min-w-0">
                      <p className="text-xs text-white truncate w-full max-w-full">{item.name || item.title}</p>
                      {item.type === 'track' && item.artist && (
                        <p className="text-[10px] text-muted truncate w-full max-w-full">{item.artist}</p>
                      )}
                      {item.type === 'artist' && (
                        <p className="text-[10px] text-muted">{t("Artist")}</p>
                      )}
                      {item.type === 'album' && (
                        <p className="text-[10px] text-muted">{t("Album")}</p>
                      )}
                    </div>
                  </motion.button>
                ))}
              </div>
            </section>
          )}
          
          {visibleRecentItems.length === 0 && (
            <div className="text-center py-16 text-muted">
              <SearchIcon size={36} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">{scope === 'online'
                ? t("Search online catalogues and playback sources from the bar at the top.")
                : scope === 'library'
                  ? t("Search your library from the bar at the top.")
                  : t("Search your library, and online, from the bar at the top.")}</p>
              <p className="text-xs mt-1 opacity-70">{t("Or just start typing anywhere in Lokal. Paste a link to download it.")}</p>
            </div>
          )}
          
        </div>
      )}

      {showSearchResults && link && <LinkDownload link={link} />}

      {showSearchResults && !link && (
        <>
          {correction && correction.from === query.trim() && (
            <p role="status" className="text-sm text-muted">
              Showing results for <button type="button" onClick={() => setQuery(correction.to)} className="font-medium italic text-white hover:underline">{correction.to}</button>
              <span className="mx-2 text-subtle">·</span>
              <button type="button" onClick={() => { exactRef.current = correction.from; doSearch(correction.from) }} className="hover:text-white hover:underline">Search for “{correction.from}” instead</button>
            </p>
          )}

          {showLibrary && showSongs && tracks.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-display text-muted uppercase tracking-widest">{t("Tracks")}</h2>
                <button onClick={() => playQueue(tracks, 0)} className="text-xs text-accent hover:text-accent/70 font-display uppercase tracking-wider transition-colors">{t("Play All")}</button>
              </div>
              <TrackList tracks={tracks} />
            </section>
          )}

          <GlobalCatalogueResults
            query={showOnline ? onlineQuery : query}
            category={resultCategory}
            enableOnline={showOnline}
            localArtists={showLibrary ? artists : []}
            localAlbums={showLibrary ? albums : []}
            onLocalArtistClick={handleArtistClick}
            onLocalAlbumClick={handleAlbumClick}
          />

          {showLibrary && showSongs && lyricMatches.length > 0 && (
            <section>
              <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3">{t("Lyrics Matches")}</h2>
              <div className="space-y-2">
                {lyricMatches.map((track, i) => (
                  <motion.button
                    key={`${track.id}-lyrics-${i}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    onClick={() => handleLyricMatchPlay(track)}
                    className="w-full text-left rounded-xl border border-border bg-elevated/70 hover:border-accent/30 hover:bg-card transition-colors px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate">{track.title}</p>
                        <p className="text-xs text-muted truncate">{track.artist}{track.album ? ` · ${track.album}` : ''}</p>
                      </div>
                      <div className="flex items-center gap-2 text-accent flex-shrink-0">
                        <span className="text-[10px] font-display uppercase tracking-[0.22em]">{t("Play")}</span>
                        <Play size={13} fill="currentColor" />
                      </div>
                    </div>
                    <p className="text-xs text-muted mt-2 truncate">{track.lyricSnippet}</p>
                  </motion.button>
                ))}
              </div>
            </section>
          )}

          {scope === 'library' && query && !searching && !hasVisibleLibraryResults && (
            <div className="flex items-center gap-3 py-3 text-muted">
              <Music size={18} className="opacity-40" />
              <p className="text-sm">Nothing in your library for "{correction?.from === query.trim() ? correction.to : query}"</p>
            </div>
          )}

          {showOnline && showSongs && <OnlineResults query={onlineQuery} soulseekFor={soulseekFor} findOn={findOnRequest} showLibraryHint={scope !== 'online'} />}
        </>
      )}
    </div>
  )
}
