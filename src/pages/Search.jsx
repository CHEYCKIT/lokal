import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Music, Disc3, Clock, User, Play, Search as SearchIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../store/player'
import { useSearchStore } from '../store/search'
import TrackList from '../components/TrackList'
import OnlineResults from '../components/OnlineResults'
import { api } from '../api'
import { HISTORY_EVENT, getRecentItems, saveRecentItem, saveRecentSearch } from '../searchHistory'
import { isStreamed } from '../onlineTracks'
import { plural } from '../plural'

// Results for what's typed in the header search box (HeaderSearch.jsx); with
// nothing typed, the things recently opened from a search.
/** The Search page: results for the header query, or recently opened items when it's empty. */
export default function Search() {
  const query = useSearchStore(s => s.query)
  const [tracks, setTracks] = useState([])
  const [artists, setArtists] = useState([])
  const [albums, setAlbums] = useState([])
  const [lyricMatches, setLyricMatches] = useState([])
  const [searching, setSearching] = useState(false)
  const [recentItems, setRecentItems] = useState(getRecentItems)
  const recentTrackSelectionRef = useRef(0)
  const searchSeqRef = useRef(0)
  const nav = useNavigate()
  const { playQueue, queue, playTrack } = usePlayerStore()
  const isSearchStarted = !!query.trim()

  useEffect(() => {
    const refresh = () => setRecentItems(getRecentItems())
    window.addEventListener(HISTORY_EVENT, refresh)
    return () => window.removeEventListener(HISTORY_EVENT, refresh)
  }, [])

  /** Search tracks, albums and lyrics for `q`; results from an outdated search are ignored. */
  const doSearch = useCallback(async (q) => {
    const seq = ++searchSeqRef.current
    if (!q.trim()) { setTracks([]); setArtists([]); setAlbums([]); setLyricMatches([]); setSearching(false); return }
    setSearching(true)
    let res, albumRes, lyricsRes
    try {
      ;[res, albumRes, lyricsRes] = await Promise.all([
        api.searchTracks(q),
        api.searchAlbums(q),
        api.searchLyrics(q),
      ])
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
  }, [])

  // Results follow the text as it's typed. A new query makes any search
  // still in flight stale straight away, not only when the debounce ends.
  useEffect(() => {
    if (!query.trim()) { doSearch(''); return }
    searchSeqRef.current++
    setSearching(true)
    const t = setTimeout(() => doSearch(query), 200)
    return () => clearTimeout(t)
  }, [query, doSearch])

  useEffect(() => {
    const handleRefresh = () => {
      if (query.trim()) {
        doSearch(query)
      }
      setRecentItems(getRecentItems())
    }
    window.addEventListener('lokal:refresh', handleRefresh)
    return () => window.removeEventListener('lokal:refresh', handleRefresh)
  }, [query, doSearch])

  const artSrc = (a) => a.image_path ? (api.isElectron ? `file://${a.image_path}` : null) : null
  const albumArt = (a) => a.artwork_path ? (api.isElectron ? `file://${a.artwork_path}` : api.artworkURL(a.id)) : null

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
      track_count: album.track_count,
      year: album.year,
      type: 'album'
    })
    nav('/albums', { state: { album } })
  }

  /** Reopen a recent item: an artist or album page, or play a track. */
  const handleRecentItemClick = async (item) => {
    if (item.type === 'artist') {
      nav(`/artist/${item.id}`)
    } else if (item.type === 'track') {
      const selectionId = ++recentTrackSelectionRef.current
      const trackIndex = queue.findIndex(t => t.id === item.id)
      if (trackIndex >= 0) {
        playQueue(queue, trackIndex)
        return
      }
      // A song streamed from search: the item has what it takes to stream it again.
      if (item.file_path && isStreamed(item)) {
        const track = { id: item.id, title: item.name, artist: item.artist, album: item.album, file_path: item.file_path, source_url: item.source_url, artwork_url: item.artwork_url, duration: item.duration }
        playTrack(track, [track])
        return
      }

      let matches
      try {
        matches = await api.getTracks({ id: item.id, limit: 1 })
      } catch (error) {
        console.error('Failed to load recent track', error)
        return
      }

      if (selectionId !== recentTrackSelectionRef.current) return

      const track = Array.isArray(matches) ? matches[0] : null
      if (track) {
        playTrack(track, [track])
      }
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

  // With a query, the results page: library matches, then online songs.
  const showSearchResults = isSearchStarted

  return (
    <div className="p-6 space-y-6 pb-10">
      {!showSearchResults && (
        <div className="space-y-6">
          {recentItems.length > 0 && (
            <section>
              <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3 flex items-center gap-2">
                <Clock size={12} /> Recent
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                {recentItems.map((item, i) => (
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
                        item.artwork_path ? (
                          <img src={api.isElectron ? `file://${item.artwork_path}` : api.artworkURL(item.id)} className="w-full h-full object-cover" />
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
                        <p className="text-[10px] text-muted">Artist</p>
                      )}
                      {item.type === 'album' && (
                        <p className="text-[10px] text-muted">Album</p>
                      )}
                    </div>
                  </motion.button>
                ))}
              </div>
            </section>
          )}
          
          {recentItems.length === 0 && (
            <div className="text-center py-16 text-muted">
              <SearchIcon size={36} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">Search your library from the bar at the top.</p>
              <p className="text-xs mt-1 opacity-70">Or just start typing anywhere in Lokal.</p>
            </div>
          )}
          
        </div>
      )}

      {showSearchResults && (
        <>
          {artists.length > 0 && (
            <section>
              <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3">Artists</h2>
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-3">
                {artists.map((a, i) => (
                  <motion.button key={a.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}
                    onClick={() => handleArtistClick(a)} className="flex flex-col items-center gap-2 group">
                    <div className="w-full aspect-square rounded-full bg-elevated border border-border overflow-hidden flex items-center justify-center text-muted group-hover:border-accent/40 transition-colors">
                      {artSrc(a) ? <img src={artSrc(a)} className="w-full h-full object-cover" /> : <Music size={20} />}
                    </div>
                    <p className="text-xs text-center text-muted group-hover:text-white truncate w-full">{a.name}</p>
                  </motion.button>
                ))}
              </div>
            </section>
          )}

          {albums.length > 0 && (
            <section>
              <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3">Albums</h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {albums.map((a, i) => (
                  <motion.button key={`${a.title}-${i}`} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }}
                    onClick={() => handleAlbumClick(a)}
                    whileHover={{ scale: 1.04 }} className="flex flex-col gap-2 text-left group">
                    <div className="w-full aspect-square rounded-xl bg-elevated border border-border overflow-hidden flex items-center justify-center">
                      {albumArt(a) ? <img src={albumArt(a)} className="w-full h-full object-cover" /> : <Disc3 size={28} className="text-muted" />}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-white truncate">{a.title}</p>
                      <p className="text-xs text-muted">{plural(a.track_count, 'track')}</p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </section>
          )}

          {tracks.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-display text-muted uppercase tracking-widest">Tracks</h2>
                <button onClick={() => playQueue(tracks, 0)} className="text-xs text-accent hover:text-accent/70 font-display uppercase tracking-wider transition-colors">Play All</button>
              </div>
              <TrackList tracks={tracks} showAlbum />
            </section>
          )}

          {lyricMatches.length > 0 && (
            <section>
              <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3">Lyrics Matches</h2>
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
                        <span className="text-[10px] font-display uppercase tracking-[0.22em]">Play</span>
                        <Play size={13} fill="currentColor" />
                      </div>
                    </div>
                    <p className="text-xs text-muted mt-2 truncate">{track.lyricSnippet}</p>
                  </motion.button>
                ))}
              </div>
            </section>
          )}

          {query && !searching && !tracks.length && !artists.length && !albums.length && !lyricMatches.length && (
            <div className="flex items-center gap-3 py-3 text-muted">
              <Music size={18} className="opacity-40" />
              <p className="text-sm">Nothing in your library for "{query}"</p>
            </div>
          )}

          <OnlineResults query={query} />
        </>
      )}
    </div>
  )
}
