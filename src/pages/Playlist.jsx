import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Heart, Music, Play, Shuffle, Trash2, Edit2, Check, X, RefreshCw, Plus, Image as ImageIcon, AlertCircle, Search, Download, Sparkles, SlidersHorizontal, Share2 } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import TrackList from '../components/TrackList'
import PlaylistCover from '../components/PlaylistCover'
import AddTracksToPlaylistModal from '../components/AddTracksToPlaylistModal'
import Modal from '../components/Modal'
import { api } from '../api'
import { describeRules, openSmartPlaylistEditor } from '../smartPlaylists'
import { openShareCard, coversOf } from '../shareCard'
import { makePlaylistContext } from '../playbackContext'
import { isPlayable } from '../onlineTracks'
import { plural } from '../plural'
import { useCachedState, usePageReady } from '../pageCache'

export default function Playlist() {
  const { id } = useParams()
  const nav = useNavigate()
  const { user } = useAppStore()
  const isLiked = id === 'liked'
  // Kept across visits, like the other pages: coming back to a playlist
  // paints it at once (and it still refetches quietly), and a new one stays
  // hidden until its songs and name are in, instead of showing "Playlist ·
  // 0 tracks · This playlist is empty" first. The route remounts per
  // playlist, so the keys never change while mounted.
  const cacheKey = isLiked ? `playlist:liked:${user?.id || 'guest'}` : `playlist:${id}`
  const [tracks, setTracks, tracksCached] = useCachedState(`${cacheKey}:tracks`, [])
  const [playlist, setPlaylist, metaCached] = useCachedState(`${cacheKey}:meta`, null)
  // A playlist is ready from the cache only with its name too (left before
  // that came in, it would show "Playlist" until it did).
  const [loaded, setLoaded] = useState(tracksCached && (isLiked || metaCached))
  usePageReady(loaded)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(() => playlist?.name || '')
  const [recommendations, setRecommendations] = useCachedState(`${cacheKey}:recs`, [])
  const [loadingRecs, setLoadingRecs] = useState(false)
  const [showAddSongs, setShowAddSongs] = useState(false)
  const [showResolveGhosts, setShowResolveGhosts] = useState(false)
  const [selectedGhostKey, setSelectedGhostKey] = useState(null)
  const [ghostQuery, setGhostQuery] = useState('')
  const [ghostLocalResults, setGhostLocalResults] = useState([])
  const [ghostYtResults, setGhostYtResults] = useState([])
  const [ghostSearchLoading, setGhostSearchLoading] = useState(false)
  const [ghostActionStatus, setGhostActionStatus] = useState('')
  const playQueue = usePlayerStore(s => s.playQueue)
  const location = useLocation()
  // load() below re-fetches on every id change but doesn't clear `playlist`
  // first, so right after navigating from one playlist to another, `playlist`
  // still holds the PREVIOUS playlist's data for as long as the new fetch is
  // in flight -- makePlaylistContext prefers playlist.id over the id fallback,
  // so playing a track during that window stored a context pointing back at
  // the playlist the user just navigated away from. Only trust `playlist`
  // once its id actually matches the current route.
  const playlistMatchesRoute = playlist && String(playlist.id) === String(id)
  const playbackContext = useMemo(
    () => makePlaylistContext(isLiked ? { id: 'liked', name: 'Liked Songs' } : (playlistMatchesRoute ? playlist : null), id),
    [isLiked, playlistMatchesRoute, playlist, id],
  )
  // Set by the "playing from ..." shortcut so we can scroll to the playing track.
  const [highlightTrackId, setHighlightTrackId] = useState(null)
  // A per-request identity, distinct from the track ID itself, so a second
  // shortcut to the *same* already-playing track still re-triggers the
  // scroll/flash in TrackList instead of being silently deduped against
  // the first request for that ID.
  const highlightSeqRef = useRef(0)
  const [highlightRequestKey, setHighlightRequestKey] = useState(null)

  useEffect(() => {
    const incoming = location.state?.highlightTrackId
    if (!incoming) return
    highlightSeqRef.current += 1
    setHighlightTrackId(incoming)
    setHighlightRequestKey(`${incoming}:${highlightSeqRef.current}`)
    // Clear it so a later refresh or back-navigation doesn't re-trigger the scroll.
    nav(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, nav])

  // Online songs are ghost tracks too, but they stream, so they play.
  const playableTracks = useMemo(() => tracks.filter(track => isPlayable(track)), [tracks])
  // Songs to resolve: entries with nothing to play (an import that found no
  // file). Streamed songs (a saved YouTube Music mix...) are ghost rows too,
  // but they play, so they aren't missing anything.
  const ghostTracks = useMemo(() => tracks.filter(track => String(track.file_path || '').startsWith('ghost://') && !isPlayable(track)), [tracks])
  const getGhostKey = useCallback((track) => String(track?.playlist_track_id || track?.added_at || track?.id || ''), [])
  const selectedGhost = ghostTracks.find(track => getGhostKey(track) === selectedGhostKey) || ghostTracks[0] || null

  // A smart playlist fills itself from its rules: no adding, removing or reordering by hand.
  const smart = !isLiked && !!playlist?.smart_rules

  const load = useCallback(() => {
    // The page shows once both the songs and the name are in (or failed).
    const done = () => setLoaded(true)
    if (isLiked) {
      Promise.resolve(api.getLikedTracks(user?.id)).then(t => {
        const liked = Array.isArray(t) ? t : []
        // Every song here is liked: its hearts (under every id it goes by)
        // show filled even when the app's liked set predates it (a liked
        // streamed song since downloaded is a new file, with a new id).
        usePlayerStore.getState().setLikedMany(liked.flatMap(track => [track.id, ...(track.also_ids || [])]), true)
        setTracks(liked)
      }).catch(() => {}).finally(done)
      return
    }
    const songs = Promise.resolve(api.getPlaylistTracks(id)).then(t => {
      setTracks(Array.isArray(t) ? t : [])
    })
    const meta = Promise.resolve(api.getPlaylists(user?.id)).then(pls => {
      const pl = (Array.isArray(pls) ? pls : []).find(p => String(p.id) === String(id))
      if (pl) {
        setPlaylist(pl)
        setNameVal(pl.name)
      }
    })
    Promise.allSettled([songs, meta]).then(done)
  }, [id, user?.id, isLiked, setTracks, setPlaylist])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const handleChange = (e) => {
      const playlistId = e?.detail?.playlistId
      if (playlistId) {
        if (String(playlistId) === String(id)) load()
      } else {
        load()
      }
    }

    const handleDeleted = (e) => {
      const playlistId = e?.detail?.playlistId
      if (playlistId && String(playlistId) === String(id)) nav('/')
      else load()
    }

    window.addEventListener('lokal:playlist-updated', handleChange)
    window.addEventListener('lokal:playlist-created', handleChange)
    window.addEventListener('lokal:playlists-changed', handleChange)
    window.addEventListener('lokal:playlist-deleted', handleDeleted)
    window.addEventListener('lokal:refresh', handleChange)

    return () => {
      window.removeEventListener('lokal:playlist-updated', handleChange)
      window.removeEventListener('lokal:playlist-created', handleChange)
      window.removeEventListener('lokal:playlists-changed', handleChange)
      window.removeEventListener('lokal:playlist-deleted', handleDeleted)
      window.removeEventListener('lokal:refresh', handleChange)
    }
  }, [id, load, nav])

  useEffect(() => {
    if (!ghostTracks.length) {
      setSelectedGhostKey(null)
      setShowResolveGhosts(false)
      return
    }
    if (!selectedGhostKey || !ghostTracks.some(track => getGhostKey(track) === selectedGhostKey)) {
      setSelectedGhostKey(getGhostKey(ghostTracks[0]))
    }
  }, [ghostTracks, selectedGhostKey, getGhostKey])

  const removeTrack = async (track) => {
    await api.removeFromPlaylist(id, track.playlist_track_id)
    setTracks(t => t.filter(tr => tr.playlist_track_id !== track.playlist_track_id))
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const saveName = async () => {
    if (!nameVal.trim() || !playlist) return
    await api.updatePlaylist(id, { name: nameVal.trim() })
    setPlaylist(p => ({ ...p, name: nameVal.trim() }))
    setEditingName(false)
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const deletePlaylist = async () => {
    if (!confirm('Delete this playlist?')) return
    await api.deletePlaylist(id)
    window.dispatchEvent(new CustomEvent('lokal:playlists-changed', {
      detail: { playlistId: id, action: 'deleted' },
    }))
    nav('/')
  }

  const handleReorder = async (newTrackIds) => {
    try {
      await api.reorderPlaylist(id, newTrackIds)
      const reorderedTracks = newTrackIds.map(trackId => tracks.find(t => t.id === trackId)).filter(Boolean)
      setTracks(reorderedTracks)
    } catch (err) {
      console.error('Failed to reorder playlist:', err)
    }
  }

  const fetchRecommendations = useCallback(async () => {
    if (isLiked) return
    setLoadingRecs(true)
    try {
      const allTracks = await api.getTracks()
      if (Array.isArray(allTracks)) {
        const currentIds = new Set(tracks.map(t => t.id))
        const currentArtists = new Set(tracks.map(t => t.artist))
        const available = allTracks.filter(t => !currentIds.has(t.id) && !String(t.file_path || '').startsWith('ghost://'))
        const related = available.filter(t => currentArtists.has(t.artist))
        const others = available.filter(t => !currentArtists.has(t.artist))
        const shuffleList = (arr) => [...arr].sort(() => Math.random() - 0.5)
        let recs = shuffleList(related).slice(0, 5)
        if (recs.length < 5) recs = [...recs, ...shuffleList(others).slice(0, 5 - recs.length)]
        setRecommendations(recs)
      }
    } catch (e) {
      console.error(e)
    }
    setLoadingRecs(false)
  }, [tracks, isLiked])

  useEffect(() => {
    if (!isLiked && !smart && tracks.length > 0 && tracks.length <= 300 && recommendations.length === 0) {
      fetchRecommendations()
    }
  }, [tracks.length, isLiked, smart, recommendations.length, fetchRecommendations])

  // A recommended song that's now in the playlist (added from Add Songs, say)
  // leaves the recommendations, cached ones included; an emptied list is
  // refilled by the effect above.
  useEffect(() => {
    if (!recommendations.length) return
    const inPlaylist = new Set(tracks.map(track => track.id))
    if (recommendations.some(track => inPlaylist.has(track.id))) {
      setRecommendations(current => current.filter(track => !inPlaylist.has(track.id)))
    }
  }, [tracks, recommendations, setRecommendations])

  const addRecommendation = async (track) => {
    await api.addToPlaylist(id, track.id)
    setRecommendations(prev => prev.filter(t => t.id !== track.id))
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const totalDuration = tracks.reduce((sum, track) => sum + (track.duration || 0), 0)
  const fmt = (seconds) => `${Math.floor(seconds / 3600) > 0 ? `${Math.floor(seconds / 3600)}h ` : ''}${Math.floor((seconds % 3600) / 60)}m`

  // The share card: its photo (or the first four covers), name and first songs.
  const sharePlaylist = () => {
    const artists = new Set(tracks.map(track => String(track.artist || '').split(/\s*,\s*/)[0]).filter(Boolean))
    openShareCard({
      kind: smart ? 'Smart playlist' : 'Playlist',
      title: isLiked ? 'Liked Songs' : (playlist?.name || 'Playlist'),
      subtitle: smart ? describeRules(playlist.smart_rules) : (playlist?.description || ''),
      art: playlist?.cover_path ? [{ path: playlist.cover_path, url: api.isElectron ? null : api.playlistCoverURL(id) }] : coversOf(tracks, 4),
      stats: [['Songs', tracks.length.toLocaleString()], ['Length', fmt(totalDuration)], ['Artists', artists.size.toLocaleString()]],
      list: { title: 'Songs', items: tracks.slice(0, 5).map(track => [track.title, track.artist]) },
    })
  }

  const shuffleTracks = () => {
    if (!playableTracks.length) return
    const shuffled = [...playableTracks].sort(() => Math.random() - 0.5)
    playQueue(shuffled, 0, playbackContext)
  }

  const uploadPlaylistPhoto = async () => {
    if (!api.isElectron || isLiked) return
    const fp = await api.openFile([{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }])
    if (!fp) return
    const dataUrl = await api.readFileAsDataURL(fp)
    if (!dataUrl) return
    const updated = await api.updatePlaylist(id, { coverData: dataUrl })
    if (updated?.id) setPlaylist(updated)
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const clearPlaylistPhoto = async () => {
    if (isLiked) return
    const updated = await api.updatePlaylist(id, { clearCover: true })
    if (updated?.id) setPlaylist(updated)
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const handleTrackAdded = () => {
    load()
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const searchGhostMatches = useCallback(async (ghostTrack, queryOverride = '') => {
    const title = String(ghostTrack?.title || '').trim()
    // Online, the artist goes with the title: "Thinking of You" alone finds
    // every song called that (Katy Perry, Sister Sledge...) before Salasa's.
    const fallbackQuery = [ghostTrack?.artist, title].map(part => String(part || '').trim()).filter(Boolean).join(' ')
    const query = String(queryOverride || fallbackQuery).trim()
    if (!ghostTrack || !query) {
      setGhostLocalResults([])
      setGhostYtResults([])
      return
    }
    setGhostQuery(query)
    setGhostSearchLoading(true)
    setGhostActionStatus('')
    try {
      const [localResult, ytResult] = await Promise.all([
        // Local copies may be tagged differently: the title finds them.
        api.searchTracks(queryOverride ? query : title || query),
        api.searchYT(query, 1),
      ])
      const localTracks = Array.isArray(localResult?.tracks)
        ? localResult.tracks
        : Array.isArray(localResult)
          ? localResult
          : []
      const ytTracks = Array.isArray(ytResult?.results)
        ? ytResult.results
        : Array.isArray(ytResult)
          ? ytResult
          : []
      setGhostLocalResults(localTracks.filter(track => !String(track.file_path || '').startsWith('ghost://')).slice(0, 8))
      setGhostYtResults(ytTracks.slice(0, 8))
    } catch (e) {
      setGhostLocalResults([])
      setGhostYtResults([])
      setGhostActionStatus('Search failed: ' + e.message)
    } finally {
      setGhostSearchLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!showResolveGhosts || !selectedGhost) {
      setGhostQuery('')
      setGhostLocalResults([])
      setGhostYtResults([])
      setGhostSearchLoading(false)
      setGhostActionStatus('')
      return
    }
    searchGhostMatches(selectedGhost)
  }, [showResolveGhosts, selectedGhost, searchGhostMatches])

  const assignGhostTrack = async (ghostTrackId, targetTrackId) => {
    setGhostActionStatus('Assigning track...')
    try {
      const result = await api.resolveGhostTrack(ghostTrackId, targetTrackId)
      if (result?.error) {
        setGhostActionStatus('Assign failed: ' + result.error)
        return
      }
      setGhostActionStatus('Assigned successfully.')
      const remainingGhosts = ghostTracks.filter(track => track.id !== ghostTrackId)
      setSelectedGhostKey(remainingGhosts[0] ? getGhostKey(remainingGhosts[0]) : null)
      setGhostLocalResults([])
      setGhostYtResults([])
      setGhostQuery('')
      load()
      window.dispatchEvent(new Event('lokal:refresh'))
      window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
    } catch (e) {
      setGhostActionStatus('Assign failed: ' + e.message)
    }
  }

  const downloadGhostResult = async (item) => {
    if (!item?.url) return
    setGhostActionStatus('Starting download...')
    try {
      const result = await api.downloadYT(item.url, { title: item.title, thumbnail: item.thumbnail || undefined, from: 'Ghost track' })
      if (result?.error) {
        setGhostActionStatus('Download failed: ' + result.error)
        return
      }
      setGhostActionStatus('Download started. Re-run search after indexing finishes.')
    } catch (e) {
      setGhostActionStatus('Download failed: ' + e.message)
    }
  }

  return (
    <div className="p-6 pb-10">
      <div className="flex items-end gap-5 mb-8">
        <div className="relative w-36 h-36 flex-shrink-0 group">
          <div className="w-36 h-36 rounded-2xl overflow-hidden bg-elevated border border-border flex items-center justify-center shadow-xl">
            {isLiked
              ? <Heart size={52} className="text-accent" fill="currentColor" />
              : <PlaylistCover playlistId={id} coverPath={playlist?.cover_path} size={144} className="w-full h-full object-cover" />
            }
          </div>
          {!isLiked && (
            <button
              onClick={uploadPlaylistPhoto}
              className="absolute inset-0 rounded-2xl bg-black/0 group-hover:bg-black/45 transition-colors flex items-center justify-center"
              title={playlist?.cover_path ? 'Change playlist photo' : 'Upload playlist photo'}
            >
              <span className="w-11 h-11 rounded-full bg-white/12 border border-white/15 text-white hover:bg-white/20 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center">
                <ImageIcon size={17} />
              </span>
            </button>
          )}
          {!isLiked && playlist?.cover_path && (
            <div className="absolute top-3 right-3">
              <button
                onClick={(e) => { e.stopPropagation(); clearPlaylistPhoto() }}
                className="w-9 h-9 rounded-full bg-red-500/20 border border-red-400/25 text-red-200 hover:bg-red-500/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100"
                title="Reset playlist photo"
              >
                <X size={15} />
              </button>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-display text-muted uppercase tracking-widest mb-2 flex items-center gap-1.5">
            {smart && <Sparkles size={11} className="text-accent" />}{smart ? 'Smart playlist' : 'Playlist'}
          </p>
          {!isLiked && editingName ? (
            <div className="flex items-center gap-2 mb-2">
              <input
                autoFocus
                value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveName()
                  if (e.key === 'Escape') setEditingName(false)
                }}
                className="bg-elevated border border-accent/50 rounded-lg px-3 py-1.5 text-xl text-white font-display outline-none"
              />
              <button onClick={saveName} className="text-accent hover:text-accent/70 transition-colors"><Check size={18} /></button>
              <button onClick={() => setEditingName(false)} className="text-muted hover:text-white transition-colors"><X size={18} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-2">
              <h1 className="text-3xl font-display text-white truncate">
                {isLiked ? 'Liked Songs' : (playlist?.name || 'Playlist')}
              </h1>
              {!isLiked && (
                <button onClick={() => setEditingName(true)} className="text-muted hover:text-white transition-colors flex-shrink-0">
                  <Edit2 size={14} />
                </button>
              )}
            </div>
          )}
          <p className="text-sm text-muted">{plural(tracks.length, 'track')}{totalDuration > 0 ? ` · ${fmt(totalDuration)}` : ''}</p>
          {smart && <p className="mt-1 text-xs text-muted/80 line-clamp-2" title={describeRules(playlist.smart_rules)}>{describeRules(playlist.smart_rules)}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <button
          onClick={() => playQueue(playableTracks, 0, playbackContext)}
          disabled={!playableTracks.length}
          className="flex items-center gap-2 px-6 py-2.5 bg-accent text-base rounded-full font-medium text-sm hover:bg-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play size={16} fill="currentColor" className="translate-x-px" /> Play All
        </button>

        <button
          onClick={shuffleTracks}
          disabled={!playableTracks.length}
          className="flex items-center gap-2 px-5 py-2.5 bg-elevated border border-border text-white/80 rounded-full font-medium text-sm hover:text-white hover:border-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Shuffle size={15} /> Shuffle
        </button>

        <button
          onClick={sharePlaylist}
          disabled={!tracks.length}
          title="Share as a picture"
          className="flex items-center gap-2 px-5 py-2.5 bg-elevated border border-border text-white/80 rounded-full font-medium text-sm hover:text-white hover:border-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Share2 size={15} /> Share
        </button>

        {!isLiked && (
          <>
            {!!ghostTracks.length && (
              <button
                onClick={() => setShowResolveGhosts(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-yellow-400/10 border border-yellow-400/20 text-yellow-100 rounded-full font-medium text-sm hover:bg-yellow-400/15 transition-colors"
              >
                <AlertCircle size={15} /> Resolve Ghost Songs ({ghostTracks.length})
              </button>
            )}

            {smart ? (
              <button
                onClick={() => openSmartPlaylistEditor(playlist)}
                className="flex items-center gap-2 px-5 py-2.5 bg-elevated border border-border text-white/80 rounded-full font-medium text-sm hover:text-white hover:border-accent/30 transition-colors"
              >
                <SlidersHorizontal size={15} /> Edit Rules
              </button>
            ) : (
              <button
                onClick={() => setShowAddSongs(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-elevated border border-border text-white/80 rounded-full font-medium text-sm hover:text-white hover:border-accent/30 transition-colors"
              >
                <Plus size={15} /> Add Songs
              </button>
            )}

            <button
              onClick={deletePlaylist}
              className="flex items-center gap-2 px-4 py-2.5 text-red-400 border border-red-400/30 rounded-full text-sm hover:bg-red-400/10 transition-colors"
            >
              <Trash2 size={14} /> Delete Playlist
            </button>
          </>
        )}
      </div>

      {/* No per-row entrance: the page fades in as a whole (see Library). */}
      <TrackList
        tracks={tracks}
        showQuality
        reduceMotion
        onRemove={!isLiked && !smart ? removeTrack : null}
        playlistId={!isLiked && !smart ? id : null}
        onReorder={!isLiked && !smart ? handleReorder : null}
        context={playbackContext}
        highlightTrackId={highlightTrackId}
        highlightRequestKey={highlightRequestKey}
      />

      {!isLiked && !smart && tracks.length <= 300 && (tracks.length > 0 || recommendations.length > 0) && (
        <div className="mt-12 mb-6">
          <div className="flex items-center justify-between mb-4 px-2">
            <h2 className="text-lg font-display text-white">Recommended Songs</h2>
            <button
              onClick={fetchRecommendations}
              disabled={loadingRecs}
              className="p-2 hover:bg-elevated rounded-full transition-colors text-muted hover:text-white"
            >
              <RefreshCw size={16} className={loadingRecs ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* A new set fades in as a whole instead of its rows popping in. */}
          <motion.div key={recommendations[0]?.id ?? 'none'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <TrackList
              tracks={recommendations}
              showQuality
              playlistId={null}
              reduceMotion
              onQuickAdd={!isLiked ? addRecommendation : null}
            />
          </motion.div>
        </div>
      )}

      {loaded && !tracks.length && (
        <div className="text-center py-20 text-muted">
          <Music size={40} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">{isLiked ? 'Like some tracks to see them here.' : smart ? 'No songs match these rules yet. Use Edit Rules to change them.' : 'This playlist is empty. Use Add Songs to build it.'}</p>
        </div>
      )}

      {!isLiked && (
        <AddTracksToPlaylistModal
          open={showAddSongs}
          onClose={() => setShowAddSongs(false)}
          playlistId={id}
          existingTrackIds={tracks.map(track => track.id)}
          onAdded={handleTrackAdded}
        />
      )}

      {!isLiked && (
        <Modal
          open={showResolveGhosts}
          onClose={() => setShowResolveGhosts(false)}
          title="Resolve Ghost Songs"
          width="max-w-5xl"
        >
          <div className="grid md:grid-cols-[260px_1fr] gap-4">
            <div className="rounded-2xl border border-border bg-card/40 overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <p className="text-xs font-display uppercase tracking-[0.24em] text-muted">Unresolved Tracks</p>
              </div>
              <div className="max-h-[28rem] overflow-y-auto divide-y divide-border">
                {ghostTracks.map(track => {
                  const trackKey = getGhostKey(track)
                  const active = trackKey === (selectedGhost ? getGhostKey(selectedGhost) : '')
                  return (
                    <button
                      key={trackKey}
                      onClick={() => setSelectedGhostKey(trackKey)}
                      className={`w-full text-left px-4 py-3 transition-colors ${active ? 'bg-accent/10' : 'hover:bg-elevated'}`}
                    >
                      <p className={`text-sm truncate ${active ? 'text-accent' : 'text-white'}`}>{track.title}</p>
                      <p className="text-xs text-muted truncate mt-1">{track.artist}</p>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-4 min-w-0">
              {selectedGhost ? (
                <>
                  <div className="rounded-2xl border border-yellow-400/20 bg-yellow-400/5 p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-yellow-400/10 border border-yellow-400/20 flex items-center justify-center flex-shrink-0">
                        <AlertCircle size={18} className="text-yellow-200" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium">{selectedGhost.title}</p>
                        <p className="text-xs text-muted mt-1">{selectedGhost.artist}{selectedGhost.album ? ` · ${selectedGhost.album}` : ''}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <input
                      value={ghostQuery}
                      onChange={e => setGhostQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') searchGhostMatches(selectedGhost, e.currentTarget.value) }}
                      placeholder="Search manually for a better match"
                      className="flex-1 bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-accent/50"
                    />
                    <button
                      onClick={() => searchGhostMatches(selectedGhost, ghostQuery)}
                      className="px-3 py-2.5 rounded-xl bg-accent/15 border border-accent/25 text-accent text-sm hover:bg-accent/25 transition-colors flex items-center gap-2"
                    >
                      <Search size={14} /> Search
                    </button>
                  </div>

                  <div className="grid lg:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-border bg-card/30 overflow-hidden">
                      <div className="px-4 py-3 border-b border-border">
                        <p className="text-xs font-display uppercase tracking-[0.22em] text-muted">Nearest Local Matches</p>
                      </div>
                      <div className="divide-y divide-border">
                        {ghostSearchLoading && (
                          <div className="px-4 py-8 text-sm text-muted">Searching your library…</div>
                        )}
                        {!ghostSearchLoading && ghostLocalResults.map(item => (
                          <div key={item.id} className="px-4 py-3 flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-white truncate">{item.title}</p>
                              <p className="text-xs text-muted truncate">{item.artist}{item.album ? ` · ${item.album}` : ''}</p>
                            </div>
                            <button
                              onClick={() => assignGhostTrack(selectedGhost.id, item.id)}
                              className="px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/25 text-accent text-xs hover:bg-accent/25 transition-colors"
                            >
                              Assign
                            </button>
                          </div>
                        ))}
                        {!ghostSearchLoading && !ghostLocalResults.length && (
                          <div className="px-4 py-8 text-sm text-muted">No close local matches yet.</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-card/30 overflow-hidden">
                      <div className="px-4 py-3 border-b border-border">
                        <p className="text-xs font-display uppercase tracking-[0.22em] text-muted">Download Suggestions</p>
                      </div>
                      <div className="divide-y divide-border">
                        {ghostSearchLoading && (
                          <div className="px-4 py-8 text-sm text-muted">Searching YouTube…</div>
                        )}
                        {!ghostSearchLoading && ghostYtResults.map(item => (
                          <div key={item.id || item.url} className="px-4 py-3 flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-white truncate">{item.title}</p>
                              <p className="text-xs text-muted truncate">{item.channel || item.artist || item.url}</p>
                            </div>
                            <button
                              onClick={() => downloadGhostResult(item)}
                              className="px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/25 text-accent text-xs hover:bg-accent/25 transition-colors flex items-center gap-1.5"
                            >
                              <Download size={12} /> Download
                            </button>
                          </div>
                        ))}
                        {!ghostSearchLoading && !ghostYtResults.length && (
                          <div className="px-4 py-8 text-sm text-muted">No download suggestions yet.</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {ghostActionStatus && <p className="text-xs text-muted">{ghostActionStatus}</p>}
                </>
              ) : (
                <div className="rounded-2xl border border-border bg-card/30 px-4 py-8 text-sm text-muted">
                  This playlist has no ghost songs left to resolve.
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
