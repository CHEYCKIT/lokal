import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Clock, Disc3, ListEnd, Loader2, Play, Plus, Search, Trash2, Radio } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import { api, peekSettings } from '../api'
import { peekCache, writeCache, usePageReady } from '../pageCache'
import { makeAlbumContext } from '../playbackContext'
import FadeImg from '../components/FadeImg'
import CoverPlay from '../components/CoverPlay'
import SelectionBar from '../components/SelectionBar'
import { useSelection } from '../selection'
import { addToPlaylistMany, addToQueueMany, playNextMany } from '../trackActions'
import { artistPath, releaseKey, useReleaseActions } from '../releaseActions'
import { plural } from '../plural'
import { openRadio } from '../radioActions'

const PAGE_SIZE = 48

function getAlbumArtwork(album) {
  return api.albumArtURL(album)
}

function releaseLabel(type) {
  if (type === 'single') return 'Single'
  if (type === 'ep') return 'EP'
  return 'Album'
}

function AlbumHero({ album, trackCount, onPlay, onArtist }) {
  const artSrc = getAlbumArtwork(album)
  const artistName = album.album_artist || album.artists || ''
  const titleRef = useRef(null)

  useEffect(() => {
    const node = titleRef.current
    if (!node) return

    const fitTitle = () => {
      const desktop = window.matchMedia('(min-width: 768px)').matches
      let size = desktop ? 48 : 30
      const minSize = desktop ? 22 : 20
      node.style.fontSize = `${size}px`

      while (size > minSize && node.scrollWidth > node.clientWidth) {
        size -= 1
        node.style.fontSize = `${size}px`
      }
    }

    fitTitle()
    const container = node.parentElement
    const observer = new ResizeObserver(fitTitle)
    if (container) observer.observe(container)
    window.addEventListener('resize', fitTitle)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fitTitle)
    }
  }, [album.title])

  return (
    <div className="relative overflow-hidden rounded-[2.25rem] border border-border bg-surface/80">
      <div
        className="absolute inset-0 scale-110 blur-3xl"
        style={{
          backgroundImage: artSrc ? `url("${artSrc}")` : 'none',
          backgroundPosition: 'center',
          backgroundSize: 'cover',
          opacity: artSrc ? 0.75 : 0,
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-black/20 via-black/35 to-black/80" />
      <div className="relative grid gap-6 p-6 @md:grid-cols-[280px_minmax(0,1fr)] @md:items-stretch @md:p-8">
        <div className="justify-self-start">
          <div className="h-44 w-44 overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/25 shadow-2xl @md:h-[280px] @md:w-[280px]">
            {artSrc ? (
              <img src={artSrc} alt={album.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Disc3 size={58} className="text-white/35" />
              </div>
            )}
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-[1.8rem] border border-white/10 bg-black/25 p-6 backdrop-blur-xl @md:h-[280px]">
          <p className="text-[11px] font-display uppercase tracking-[0.34em] text-white/55">{releaseLabel(album.release_type)}</p>
          <h1
            ref={titleRef}
            className="mt-3 max-w-full truncate overflow-hidden font-display uppercase leading-[0.95] tracking-[0.08em] text-white"
            style={{ fontSize: 'clamp(1.75rem, 4vw, 3rem)' }}
          >
            {album.title}
          </h1>
          {artistName ? (
            <button
              type="button"
              onClick={onArtist}
              className="mt-4 inline-flex max-w-full truncate text-left text-sm !text-white transition-colors hover:!text-accent hover:underline hover:decoration-accent hover:underline-offset-4 @md:text-base"
            >
              {artistName}
            </button>
          ) : (
            <p className="mt-4 truncate text-sm text-white/45 @md:text-base">Unknown Artist</p>
          )}
          <p className="mt-3 text-xs uppercase tracking-[0.24em] text-white/45">
            {plural(trackCount, 'track')}{album.year ? ` • ${album.year}` : ''}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={onPlay}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
            >
              <Play size={15} fill="currentColor" />
              Play
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Cards on the first screen skip their own entrance: the page already fades
// in, and dozens of card animations running with it dropped frames.
const FIRST_SCREEN_CARDS = 24

/**
 * One release in the grid, Spotify style: the cover shows unobstructed and
 * plays the release (darkened, with a play glyph, on hover); the name and
 * the text under it open it.
 */
function AlbumCard({ album, onClick, onPlay, onContextMenu, selected = false, animateIn = true }) {
  const artSrc = getAlbumArtwork(album)

  return (
    <motion.div
      initial={animateIn ? { opacity: 0, y: 10 } : false}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12, margin: '180px 0px' }}
      whileHover={{ y: -3 }}
      onContextMenu={onContextMenu}
      aria-selected={selected}
      className={`group overflow-hidden rounded-[1.5rem] border bg-card/60 transition-colors ${selected ? 'border-accent ring-2 ring-accent/60' : 'border-border hover:border-accent/35'}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '320px' }}
    >
      <div className="relative aspect-square overflow-hidden bg-black/20">
        {artSrc ? (
          // (A blurred copy used to sit under the cover, entirely hidden by
          // it: a full-size blur per card for nothing.)
          <FadeImg src={artSrc} alt={album.title} className="relative h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Disc3 size={34} className="text-muted" />
          </div>
        )}
        <CoverPlay label={`Play ${album.title}`} onPlay={onPlay} />
        {selected && (
          <span className="pointer-events-none absolute left-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-base shadow-lg">
            <Check size={14} strokeWidth={3} />
          </span>
        )}
      </div>
      <button type="button" onClick={(event) => onClick?.(event)} className="group/open relative block w-full overflow-hidden px-4 py-3 text-left">
        <div
          className="absolute inset-0 scale-110 blur-xl"
          style={{
            backgroundImage: artSrc ? `url("${artSrc}")` : 'none',
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            opacity: artSrc ? 0.18 : 0,
          }}
        />
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative space-y-1">
          <p className="truncate text-sm font-medium text-white decoration-white/60 underline-offset-2 group-hover/open:underline">{album.title}</p>
          <p className="truncate text-xs text-muted">{album.artists || album.album_artist || 'Unknown Artist'}</p>
          <p className="text-[11px] uppercase leading-snug tracking-[0.16em] text-muted/70">
            {releaseLabel(album.release_type)} • {plural(album.track_count, 'track')}{album.year ? ` • ${album.year}` : ''}
          </p>
        </div>
      </button>
    </motion.div>
  )
}

export default function Albums() {
  // Last visit's releases (and the settings already read) paint at once on
  // the way back, instead of "Loading releases..." first; they refresh quietly.
  const [albums, setAlbumsState] = useState(() => peekCache('albums:all') || [])
  const setAlbums = (list) => { writeCache('albums:all', list); setAlbumsState(list) }
  const [selectedAlbum, setSelectedAlbum] = useState(null)
  const [albumTracks, setAlbumTracks] = useState([])
  const [loadingAlbums, setLoadingAlbums] = useState(() => !peekCache('albums:all'))
  const [loadingTracks, setLoadingTracks] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [query, setQuery] = useState('')
  const [hoveredTrack, setHoveredTrack] = useState(null)
  const [visibleByType, setVisibleByType] = useState({ all: PAGE_SIZE, album: PAGE_SIZE, ep: PAGE_SIZE, single: PAGE_SIZE })
  const [settings, setSettings] = useState(() => peekSettings() || {})
  const loadMoreRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()
  // Opening a given album: wait for its tracks too, so the grid doesn't show first.
  usePageReady(!loadingAlbums && (!location.state?.album || albumTracks.length > 0))
  const { playQueue, currentTrack, isPlaying, togglePlay, playTrack } = usePlayerStore()
  const albumContext = useMemo(() => makeAlbumContext(selectedAlbum), [selectedAlbum])
  // Set by the bottom-bar / now-playing shortcuts so we can flash the playing track.
  const [highlightTrackId, setHighlightTrackId] = useState(null)
  const highlightRowRef = useRef(null)

  // True once the highlighted track's row actually exists to flash/scroll
  // to. A plain boolean (not the track object/array) so the timer effect
  // below only restarts when readiness itself flips, not on every
  // unrelated albumTracks re-fetch.
  const highlightTrackReady = !!highlightTrackId && albumTracks.some((track) => track.id === highlightTrackId)

  useEffect(() => {
    if (!highlightTrackReady) return
    const node = highlightRowRef.current
    if (!node) return
    requestAnimationFrame(() => {
      try {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch {
        node.scrollIntoView()
      }
    })
  }, [highlightTrackReady, highlightTrackId])

  // Kept separate so re-renders can't cancel the flash timer. Gated on
  // highlightTrackReady (not just highlightTrackId) so a slow
  // api.getAlbumTracks() can't have this timer clear the highlight before
  // the matching row ever renders -- if getAlbumTracks takes longer than
  // 2s, the countdown now only starts once the row is actually there.
  useEffect(() => {
    if (!highlightTrackReady) return
    const timer = setTimeout(() => setHighlightTrackId(null), 2000)
    return () => clearTimeout(timer)
  }, [highlightTrackReady, highlightTrackId])

  const loadAlbums = () => {
    // The cache, not `albums`: the refresh handler keeps an older render's
    // closure, where the list can still be empty.
    if (!peekCache('albums:all')?.length) setLoadingAlbums(true)
    Promise.all([api.getAllAlbums(), api.getSettings().catch(() => null)]).then(([result, loadedSettings]) => {
      if (Array.isArray(result)) setAlbums(result) // an error keeps what's shown
      if (loadedSettings && !loadedSettings.error) setSettings(loadedSettings)
      setLoadingAlbums(false)
    })
  }

  useEffect(() => {
    let active = true
    Promise.all([api.getAllAlbums(), api.getSettings().catch(() => null)]).then(([result, loadedSettings]) => {
      if (!active) return
      if (Array.isArray(result)) setAlbums(result) // an error keeps what's shown
      if (loadedSettings && !loadedSettings.error) setSettings(loadedSettings)
      setLoadingAlbums(false)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const handleRefresh = () => {
      loadAlbums()
      if (selectedAlbum?.title) {
        setLoadingTracks(true)
        api.getAlbumTracks(selectedAlbum).then((tracks) => {
          setAlbumTracks(Array.isArray(tracks) ? tracks : [])
          setLoadingTracks(false)
        })
      }
    }
    window.addEventListener('lokal:refresh', handleRefresh)
    return () => window.removeEventListener('lokal:refresh', handleRefresh)
  }, [selectedAlbum?.title, selectedAlbum?.album_artist])

  useEffect(() => {
    if (!albums.length) return
    const incomingAlbum = location.state?.album

    if (!incomingAlbum) {
      setSelectedAlbum(null)
      setHighlightTrackId(null)
      return
    }

    const match = albums.find((album) => album.title === incomingAlbum.title && (!incomingAlbum.album_artist || album.album_artist === incomingAlbum.album_artist))
    setSelectedAlbum(match || incomingAlbum)
    setHighlightTrackId(location.state?.highlightTrackId || null)
  }, [albums, location.pathname, location.state])

  const showSingles = settings.show_singles_in_albums !== '0'
  const separateByType = settings.separate_album_types !== '0'

  const filteredAlbums = useMemo(() => {
    const lower = query.trim().toLowerCase()
    const base = albums.filter((album) => {
      if (!showSingles && album.release_type === 'single') return false
      if (!lower) return true
      const title = String(album.title || '').toLowerCase()
      const artists = String(album.artists || album.album_artist || '').toLowerCase()
      return title.includes(lower) || artists.includes(lower)
    })

    const sortMode = settings.album_sort_mode || 'default'
    const safeAddedAt = (a) => {
      const v = a?.added_at
      if (v === undefined || v === null || v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }

    // default = existing behavior from current server order (don’t reorder)
    if (sortMode === 'newest') {
      return [...base].sort((l, r) => {
        const la = safeAddedAt(l) ?? -Infinity
        const ra = safeAddedAt(r) ?? -Infinity
        if (ra !== la) return ra - la
        const ly = Number(l?.year || 0)
        const ry = Number(r?.year || 0)
        if (ry !== ly) return ry - ly
        return String(l?.title || '').localeCompare(String(r?.title || ''), undefined, { sensitivity: 'base' })
      })
    }

    return base
  }, [albums, query, showSingles, settings.album_sort_mode])

  useEffect(() => {
    setVisibleByType({ all: PAGE_SIZE, album: PAGE_SIZE, ep: PAGE_SIZE, single: PAGE_SIZE })
    setLoadingMore(false)
  }, [filteredAlbums, separateByType])

  const sectionSource = useMemo(() => {
    if (!separateByType) {
      return [{ key: 'all', label: 'Releases', items: filteredAlbums }]
    }
    return [
      { key: 'album', label: 'Albums', items: filteredAlbums.filter((album) => album.release_type === 'album') },
      { key: 'ep', label: 'EPs', items: filteredAlbums.filter((album) => album.release_type === 'ep') },
      { key: 'single', label: 'Singles', items: filteredAlbums.filter((album) => album.release_type === 'single') },
    ].filter((group) => group.items.length > 0)
  }, [filteredAlbums, separateByType])

  const groupedAlbums = useMemo(() => {
    return sectionSource.map((group) => ({
      ...group,
      items: group.items.slice(0, visibleByType[group.key] || PAGE_SIZE),
    }))
  }, [sectionSource, visibleByType])

  const hasMore = useMemo(() => {
    return sectionSource.some((group) => (visibleByType[group.key] || PAGE_SIZE) < group.items.length)
  }, [sectionSource, visibleByType])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !hasMore) return
    const root = document.querySelector('main.flex-1.overflow-y-auto') || null
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || loadingMore) return
      setLoadingMore(true)
      window.setTimeout(() => {
        setVisibleByType((current) => {
          const next = { ...current }
          for (const group of sectionSource) {
            next[group.key] = Math.min((current[group.key] || PAGE_SIZE) + PAGE_SIZE, group.items.length)
          }
          return next
        })
        setLoadingMore(false)
      }, 80)
    }, { root, rootMargin: '800px 0px', threshold: 0.01 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, sectionSource])

  useEffect(() => {
    if (!selectedAlbum?.title) return
    const root = document.querySelector('main.flex-1.overflow-y-auto')
    if (!root) return
    root.scrollTop = 0
  }, [selectedAlbum?.title])

  useEffect(() => {
    if (!selectedAlbum?.title) {
      setAlbumTracks([])
      return
    }
    let active = true
    setLoadingTracks(true)
    api.getAlbumTracks(selectedAlbum).then((tracks) => {
      if (!active) return
      setAlbumTracks(Array.isArray(tracks) ? tracks : [])
      setLoadingTracks(false)
    })
    return () => {
      active = false
    }
  }, [selectedAlbum?.title, selectedAlbum?.album_artist])

  const handleTrackPlay = (track, index, event) => {
    event?.stopPropagation?.()
    if (currentTrack?.id === track.id) {
      togglePlay()
      return
    }
    playTrack(track, albumTracks, albumContext)
  }

  // ---- Selecting releases (grid) and songs (album page): Ctrl/Cmd+click
  // or Shift+click selects, a right click or the bar acts on them.
  const releases = useReleaseActions({
    onDeleted: (ids) => {
      const gone = new Set(ids.map(String))
      setAlbumTracks(current => current.filter(track => !gone.has(String(track.id))))
      releaseSelection.clear()
      trackSelection.clear()
    },
  })
  const { menu } = releases
  const shownAlbums = useMemo(() => groupedAlbums.flatMap(group => group.items), [groupedAlbums])
  const shownKeys = useMemo(() => shownAlbums.map(releaseKey), [shownAlbums])
  const releasesFor = (keys) => shownAlbums.filter(album => keys.includes(releaseKey(album)))
  const releaseSelection = useSelection(shownKeys, { onDelete: (keys) => releases.askDelete(releasesFor(keys)) })
  const selectedReleases = () => releasesFor([...releaseSelection.selected])
  const openReleaseMenu = (event, album) => releases.openMenu(event, releasesFor(releaseSelection.contextSelect(releaseKey(album))))

  // Songs on the album page: double click (or the number's button) plays.
  const albumTrackIds = useMemo(() => albumTracks.map(track => track.id), [albumTracks])
  const askDeleteTracks = releases.askDeleteTracks
  const trackSelection = useSelection(albumTrackIds, { onDelete: (ids) => askDeleteTracks(albumTracks.filter(track => ids.includes(String(track.id)))) })
  const selectedAlbumTracks = () => albumTracks.filter(track => trackSelection.has(track.id))
  const openTrackMenu = (event, track) => {
    const ids = trackSelection.contextSelect(track.id)
    const list = albumTracks.filter(item => ids.includes(String(item.id)))
    const count = list.length > 1 ? ` ${list.length} songs` : ''
    menu.open(event, [
      { label: `Play${count}`, icon: Play, onSelect: () => (list.length === 1 ? playQueue(albumTracks, albumTracks.indexOf(list[0]), albumContext) : playQueue(list, 0, albumContext)) },
      { label: 'Play next', icon: Clock, onSelect: () => playNextMany(list) },
      { label: 'Add to queue', icon: ListEnd, onSelect: () => addToQueueMany(list) },
      { label: 'Add to playlist…', icon: Plus, onSelect: () => addToPlaylistMany(list) },
      list.length === 1 && { label: 'Start radio', icon: Radio, onSelect: () => openRadio(navigate, list[0], useAppStore.getState().user?.id) },
      { separator: true },
      { label: list.length > 1 ? `Delete${count} from library` : 'Delete from library', icon: Trash2, danger: true, onSelect: () => askDeleteTracks(list) },
    ])
  }

  const playAlbumRelease = async (album) => {
    const tracks = await api.getAlbumTracks(album)
    if (Array.isArray(tracks) && tracks.length) {
      playQueue(tracks, 0, makeAlbumContext(album))
    }
  }

  return (
    <div className="min-h-full p-6 pb-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 @md:flex-row @md:items-end @md:justify-between">
          <div>
            <p className="text-[11px] font-display uppercase tracking-[0.32em] text-muted">Collection</p>
            <h1 className="mt-2 font-display text-3xl uppercase tracking-[0.14em] text-white">Albums</h1>
            <p className="mt-3 text-sm text-muted">
              {loadingAlbums ? '\u00a0' : `${filteredAlbums.length.toLocaleString()} visible releases`}
            </p>
          </div>
          <div className="flex w-full max-w-xl flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-end">
            {selectedAlbum && (
              <button
                onClick={() => navigate(-1)}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-elevated/90 px-3 py-2 text-sm text-white/80 transition-colors hover:border-accent/40 hover:text-white"
              >
                <ArrowLeft size={14} />
                Back
              </button>
            )}
            <div className="relative w-full">
              <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search albums, singles, EPs, or artists..."
                className="w-full rounded-2xl border border-border bg-elevated/90 pl-11 pr-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent/50 placeholder:text-muted"
              />
            </div>

            <div className="flex items-center gap-2 justify-start @sm:justify-end">
              <label className="text-[11px] text-muted uppercase tracking-[0.16em]">Sort</label>
              <select
                value={settings.album_sort_mode || 'default'}
                onChange={(e) => {
                  const v = e.target.value
                  setSettings((s) => ({ ...s, album_sort_mode: v }))
                  api.saveSettings({ ...settings, album_sort_mode: v })
                }}
                className="bg-elevated/90 border border-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
              >
                <option value="default">Default</option>
                <option value="newest">Newest</option>
              </select>
            </div>
          </div>
        </div>

        {selectedAlbum ? (
          <div className="space-y-6">
            <AlbumHero
              album={selectedAlbum}
              trackCount={albumTracks.length || selectedAlbum.track_count || 0}
              onPlay={() => albumTracks.length && playQueue(albumTracks, 0, albumContext)}
              onArtist={() => navigate(artistPath(selectedAlbum.album_artist || selectedAlbum.artists))}
            />

            <div className="overflow-hidden rounded-[1.75rem] border border-border bg-surface/80">
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div>
                  <p className="text-[11px] font-display uppercase tracking-[0.32em] text-muted">Tracklist</p>
                  <p className="mt-1 text-sm text-white/65">
                    {loadingTracks ? 'Loading tracks...' : plural(albumTracks.length, 'track')}
                  </p>
                </div>
                {albumTracks.length > 0 && (
                  <button
                    onClick={() => playQueue(albumTracks, 0, albumContext)}
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-white transition-colors hover:border-accent/40"
                  >
                    <Play size={14} fill="currentColor" />
                    Play
                  </button>
                )}
              </div>

              {loadingTracks ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={24} className="animate-spin text-muted" />
                </div>
              ) : albumTracks.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-muted">No tracks found for this release.</div>
              ) : (
                <div className="divide-y divide-border/60" onClick={trackSelection.clear}>
                  <SelectionBar
                    open={trackSelection.count > 0}
                    label={`${trackSelection.count} selected`}
                    onClear={trackSelection.clear}
                    actions={[
                      { label: 'Play', icon: Play, onClick: () => playQueue(selectedAlbumTracks(), 0, albumContext) },
                      { label: 'Play next', icon: Clock, onClick: () => playNextMany(selectedAlbumTracks()) },
                      { label: 'Add to queue', icon: ListEnd, onClick: () => addToQueueMany(selectedAlbumTracks()) },
                      { label: 'Add to playlist', icon: Plus, onClick: () => addToPlaylistMany(selectedAlbumTracks()) },
                      { label: 'Delete', icon: Trash2, danger: true, onClick: () => askDeleteTracks(selectedAlbumTracks()) },
                    ]}
                  />
                  {albumTracks.map((track, index) => {
                    const isCurrent = currentTrack?.id === track.id
                    const isHovered = hoveredTrack === track.id
                    const isHighlighted = !!highlightTrackId && track.id === highlightTrackId
                    const isSelected = trackSelection.has(track.id)
                    return (
                      // Ctrl/Cmd+click selects (Shift a range), double click or the
                      // number's play button plays, right click for more.
                      <div
                        key={track.id}
                        ref={isHighlighted ? highlightRowRef : undefined}
                        role="row"
                        tabIndex={0}
                        aria-selected={isSelected}
                        onClick={(event) => { event.stopPropagation(); trackSelection.click(track.id, event) }}
                        onDoubleClick={() => playQueue(albumTracks, index, albumContext)}
                        onKeyDown={(event) => { if (event.key === 'Enter') playQueue(albumTracks, index, albumContext) }}
                        onContextMenu={(event) => openTrackMenu(event, track)}
                        onMouseEnter={() => setHoveredTrack(track.id)}
                        onMouseLeave={() => setHoveredTrack(null)}
                        className={`flex w-full cursor-default select-none items-center gap-4 px-6 py-3 text-left outline-none transition-colors focus-visible:bg-elevated/80 ${isSelected ? 'bg-accent/15' : isCurrent ? 'bg-accent/10' : 'hover:bg-elevated/80'} ${isHighlighted ? 'ring-2 ring-accent bg-accent/15 animate-pulse' : ''}`}
                      >
                        <div className="flex w-8 items-center justify-center">
                          {isHovered || isCurrent ? (
                            <button type="button" onClick={(event) => handleTrackPlay(track, index, event)}
                              aria-label={isCurrent && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                              className={isCurrent ? 'text-accent' : 'text-white'}>
                              {isCurrent && isPlaying ? (
                                <Disc3 size={14} className="animate-spin" />
                              ) : (
                                <Play size={14} fill="currentColor" className="translate-x-px" />
                              )}
                            </button>
                          ) : (
                            <span className={`text-xs font-display ${isCurrent ? 'text-accent' : 'text-muted'}`}>
                              {track.display_track_num || track.track_num || index + 1}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm ${isCurrent ? 'text-accent' : 'text-white'}`}>{track.title}</p>
                          <p className="truncate text-xs text-muted">{track.artist}</p>
                        </div>
                        <span className="text-xs text-muted">
                          {track.duration ? `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}` : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ) : loadingAlbums ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={28} className="animate-spin text-muted" />
          </div>
        ) : filteredAlbums.length === 0 ? (
          <div className="py-24 text-center">
            <Disc3 size={42} className="mx-auto mb-4 text-muted/30" />
            <p className="text-sm text-muted">{query.trim() ? 'No releases matched that search.' : 'No releases in your library yet.'}</p>
          </div>
        ) : (
          <div className="space-y-10">
            <SelectionBar
              open={releaseSelection.count > 0}
              label={`${releaseSelection.count} ${releaseSelection.count === 1 ? 'release' : 'releases'} selected`}
              onClear={releaseSelection.clear}
              actions={releases.barActions(selectedReleases())}
            />
            {groupedAlbums.map((group) => (
              <section key={group.key} className="space-y-4">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-display uppercase tracking-[0.32em] text-muted">{group.label}</p>
                    <p className="mt-1 text-sm text-white/60">{group.items.length} shown</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 @sm:grid-cols-3 @lg:grid-cols-5 @xl:grid-cols-6">
                  {group.items.map((album, index) => (
                    <AlbumCard
                      key={`${group.key}-${album.title}-${album.album_artist || album.artists || 'release'}-${index}`}
                      album={album}
                      selected={releaseSelection.has(releaseKey(album))}
                      // Ctrl/Cmd or Shift + click selects instead of opening or playing.
                      onClick={(event) => {
                        if (!releaseSelection.click(releaseKey(album), event)) navigate('/albums', { state: { album } })
                      }}
                      onPlay={(event) => {
                        if (!releaseSelection.click(releaseKey(album), event)) playAlbumRelease(album)
                      }}
                      onContextMenu={(event) => openReleaseMenu(event, album)}
                      animateIn={index >= FIRST_SCREEN_CARDS}
                    />
                  ))}
                </div>
              </section>
            ))}
            {(hasMore || loadingMore) && (
              <div ref={loadMoreRef} className="flex min-h-20 items-center justify-center">
                {loadingMore ? <Loader2 size={18} className="animate-spin text-muted" /> : <p className="text-xs text-muted/60">Scroll for more</p>}
              </div>
            )}
          </div>
        )}
      </div>
      {releases.elements}
    </div>
  )
}
