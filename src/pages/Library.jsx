import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { LayoutGrid, List, Music, Disc3, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../store/player'
import TrackList from '../components/TrackList'
import FadeImg from '../components/FadeImg'
import ScanBanner from '../components/ScanBanner'
import LibraryFolderBrowser from '../components/LibraryFolderBrowser'
import { api } from '../api'
import { useCachedState, usePageReady } from '../pageCache'
import { useTranslation } from '../i18n'

const LIBRARY_PAGE_SIZE = 50
const HEAVY_GRID_THRESHOLD = 80

export default function Library() {
  const { t } = useTranslation()
  // Kept across visits (with the sort and view they were shown in), so coming
  // back paints the list at once instead of "No tracks yet" first.
  const [tracks, setTracks, wasCached] = useCachedState('library:tracks', [])
  const [sort, setSort] = useCachedState('library:sort', 'added_at DESC')
  // Where the songs came from (see sourceFilter in electron/ipc/scanner.js).
  const [source, setSource] = useCachedState('library:source', 'all')
  // One genre, or '' for all (matches a song's main genre or any of its genres).
  const [genre, setGenre] = useCachedState('library:genre', '')
  const [genres, setGenres] = useCachedState('library:genres', [])
  // One audio quality tier, or '' for all (the Audio Quality page's tiers).
  const [quality, setQuality] = useCachedState('library:quality', '')
  const [problemsOnly, setProblemsOnly] = useCachedState('library:problemsOnly', false)
  const [view, setView] = useCachedState('library:view', 'list')
  const [libraryMode, setLibraryMode] = useCachedState('library:mode', 'simple')
  const [folderPath, setFolderPath] = useCachedState('library:folderPath', '')
  const [folderSearch, setFolderSearch] = useState('')
  const [folderData, setFolderData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useCachedState('library:hasMore', true)
  // The empty state waits for the first answer instead of showing meanwhile.
  const [loaded, setLoaded] = useState(wasCached)
  usePageReady(loaded)
  const playQueue = usePlayerStore(s => s.playQueue)
  const navigate = useNavigate()
  const offsetRef = useRef(tracks.length)
  const loadingRef = useRef(false)
  const loadMoreRef = useRef(null)
  const requestIdRef = useRef(0)
  const shouldAnimateGrid = tracks.length <= HEAVY_GRID_THRESHOLD
  const playAllTracks = libraryMode === 'simple'
    ? tracks
    : (folderData?.filteredTracks || (folderData?.tracks?.length ? folderData.tracks : folderData?.allTracks) || [])

  const load = async (append = false) => {
    // Synchronous in-flight check: the observer's `loading` can be stale, and a
    // load-more mustn't supersede the first-page refresh (or run twice).
    if (loadingRef.current && append) return
    const requestId = ++requestIdRef.current
    const nextOffset = append ? offsetRef.current : 0
    loadingRef.current = true
    setLoading(true)
    try {
      const result = await api.getTracks({ sort, limit: LIBRARY_PAGE_SIZE, offset: nextOffset, ...(source !== 'all' ? { source } : {}), ...(genre ? { genre } : {}), ...(quality ? { quality } : {}), ...(problemsOnly ? { problems: true } : {}) })
      if (requestId !== requestIdRef.current) return
      // A failed request keeps the list already shown (and cached).
      if (!Array.isArray(result)) return
      const items = problemsOnly ? result : result.filter(track => !String(track?.file_path || '').startsWith('ghost://'))
      offsetRef.current = nextOffset + items.length
      setTracks(prev => append ? [...prev, ...items] : items)
      setHasMore(items.length === LIBRARY_PAGE_SIZE)
      // Only a real answer ends the first load ("No tracks yet" must be true).
      setLoaded(true)
    } finally {
      if (requestId === requestIdRef.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }

  // The list on screen (from last time, or the previous sort) stays until
  // the new first page replaces it; a failed request leaves it as it is.
  useEffect(() => {
    // Another sort or source: nothing more is fetched (or appended) until its
    // first page is in, so two lists are never mixed.
    offsetRef.current = 0
    setHasMore(false)
    load(false)
  }, [sort, source, genre, quality, problemsOnly])

  useEffect(() => {
    const handleRefresh = () => { load(false); loadGenres() }
    window.addEventListener('lokal:refresh', handleRefresh)
    return () => window.removeEventListener('lokal:refresh', handleRefresh)
  }, [sort, source, genre, quality, problemsOnly])

  // The genres to pick from: every one in the library, on opening and after a refresh.
  const loadGenres = () => Promise.resolve(api.getAllGenres())
    .then(list => { if (Array.isArray(list)) setGenres(list.filter(g => typeof g === 'string' && g.trim())) })
    .catch(() => {})
  useEffect(() => { loadGenres() }, [])

  useEffect(() => {
    if (!hasMore || loading) return
    const node = loadMoreRef.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        load(true)
      }
    }, { rootMargin: '300px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loading, sort, source, genre, quality, problemsOnly, tracks.length])

  const artSrc = (t) => t.artwork_path
    ? (api.isElectron ? api.fileURL(t.artwork_path) : api.artworkURL(t.id))
    : null

  return (
    <div className="p-6 space-y-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg uppercase tracking-widest text-white">{t("Library")}</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button onClick={() => navigate('/albums')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-elevated border border-border rounded-lg text-xs text-muted hover:text-white transition-colors">
            <Disc3 size={13} /> {t("Albums")}
          </button>
          {libraryMode === 'simple' && (
            <>
          <select value={source} onChange={e => setSource(e.target.value)} aria-label={t("Source")}
            className="bg-elevated border border-border rounded-lg px-3 py-1.5 text-xs text-muted outline-none focus:border-accent/50">
            <option value="all">{t("All sources")}</option>
            <option value="local">{t("Music folder")}</option>
            <option value="yt">{t("YouTube")}</option>
            <option value="sc">{t("SoundCloud")}</option>
            <option value="addon">{t("Addons")}</option>
            <option value="soulseek">{t("Soulseek")}</option>
            <option value="web">{t("Other sites")}</option>
          </select>
          <select value={genre} onChange={e => setGenre(e.target.value)} aria-label={t("Genres")}
            className={`max-w-[11rem] truncate bg-elevated border rounded-lg px-3 py-1.5 text-xs outline-none focus:border-accent/50 ${genre ? 'border-accent/40 text-accent' : 'border-border text-muted'}`}>
            <option value="">{t("All genres")}</option>
            {/* The one picked stays listed even if no song has it any more. */}
            {genre && !genres.some(g => g.toLowerCase() === genre.toLowerCase()) && <option value={genre}>{genre}</option>}
            {genres.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={quality} onChange={e => setQuality(e.target.value)} aria-label={t("Quality")}
            className={`bg-elevated border rounded-lg px-3 py-1.5 text-xs outline-none focus:border-accent/50 ${quality ? 'border-accent/40 text-accent' : 'border-border text-muted'}`}>
            <option value="">{t("All qualities")}</option>
            <option value="hires">{t("Hi-res")}</option>
            <option value="lossless">{t("Lossless")}</option>
            <option value="high">{t("High")}</option>
            <option value="low">{t("Low")}</option>
            <option value="suspect">{t("Suspect")}</option>
          </select>
          <label title={t("Only songs that can't be played: their file is missing, or playing them failed")} className={`flex items-center gap-1.5 text-xs ${problemsOnly ? 'text-accent' : 'text-muted'}`}><input type="checkbox" checked={problemsOnly} onChange={e => setProblemsOnly(e.target.checked)} className="accent-accent" />{t("Songs with errors")}</label>
          <select value={sort} onChange={e => setSort(e.target.value)} aria-label={t("Sort")}
            className="bg-elevated border border-border rounded-lg px-3 py-1.5 text-xs text-muted outline-none focus:border-accent/50">
            <option value="added_at DESC">{t("Recently Added")}</option>
            <option value="title ASC">{t("Title A-Z")}</option>
            <option value="artist ASC">{t("Artist A-Z")}</option>
            <option value="play_count DESC">{t("Most Played")}</option>
            <option value="duration DESC">{t("Longest")}</option>
          </select>
            </>
          )}
          {libraryMode === 'advanced' && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-white">
              <Search size={14} className="flex-shrink-0 text-muted" />
              <input
                type="text"
                value={folderSearch}
                onChange={e => setFolderSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setFolderSearch('') }}
                placeholder={t("Search folders & tracks…")}
                aria-label={t("Search folders and tracks")}
                className="w-36 bg-transparent text-xs text-white outline-none placeholder:text-muted focus:w-48 transition-all @sm:w-44"
              />
              {folderSearch && (
                <button
                  type="button"
                  onClick={() => setFolderSearch('')}
                  aria-label={t("Clear search")}
                  className="flex-shrink-0 text-muted transition-colors hover:text-white"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )}
          <div className="flex bg-elevated border border-border rounded-lg overflow-hidden">
            <button onClick={() => setView('list')} className={`p-1.5 transition-colors ${view === 'list' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'}`}><List size={14} /></button>
            <button onClick={() => setView('grid')} className={`p-1.5 transition-colors ${view === 'grid' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'}`}><LayoutGrid size={14} /></button>
          </div>
        </div>
      </div>

      <ScanBanner />

      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-xs text-muted font-display">
          {libraryMode === 'simple'
            ? tracks.length + ' ' + t('loaded tracks')
            : folderData?.available
              ? (folderSearch.trim() && folderData.matchCount != null
                  ? `${folderData.matchCount} ${folderData.matchCount === 1 ? t('match') : t('matches')} · ${folderData.relativePath || folderData.rootName}`
                  : `${folderData.totalTracks != null ? folderData.totalTracks : (folderData.tracks?.length || 0)} ${(folderData.totalTracks != null ? folderData.totalTracks : (folderData.tracks?.length || 0)) === 1 ? t('track') : t('tracks')} · ${folderData.relativePath || folderData.rootName}`)
              : t('Browse your music folders')}
        </p>
        <div className="flex flex-shrink-0 items-center gap-3">
          {playAllTracks.length > 0 && (
            <button onClick={() => playQueue(playAllTracks, 0, libraryMode === 'advanced' ? { type: 'library-folder' } : null)} className="text-xs text-accent hover:text-accent/70 font-display uppercase tracking-wider transition-colors">{t("Play All")}</button>
          )}
          <button
            type="button"
            onClick={() => setLibraryMode(libraryMode === 'simple' ? 'advanced' : 'simple')}
            aria-pressed={libraryMode === 'advanced'}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${libraryMode === 'advanced' ? 'border-accent/40 bg-accent/15 text-accent' : 'border-border bg-elevated text-muted hover:text-white'}`}
          >
            {libraryMode === 'simple' ? t('Advanced') : t('Simple')}
          </button>
        </div>
      </div>

      {libraryMode === 'advanced' && (
        <LibraryFolderBrowser
          folderPath={folderPath}
          onFolderChange={setFolderPath}
          onDataChange={setFolderData}
          view={view}
          playQueue={playQueue}
          artSrc={artSrc}
          searchQuery={folderSearch}
          onSearchQueryChange={setFolderSearch}
        />
      )}

      {libraryMode === 'simple' && tracks.length > 0 && view === 'list' && (
        <>
          {/* No per-row entrance: the page fades in as a whole, and 50 row
              animations in the same frames made that fade stutter. */}
          <TrackList tracks={tracks} showQuality reduceMotion />
        </>
      )}

      {libraryMode === 'simple' && tracks.length > 0 && view === 'grid' && (
        <div className="grid grid-cols-3 @sm:grid-cols-4 @md:grid-cols-5 gap-3">
          {tracks.map((t, i) => {
            const src = artSrc(t)
            return (
              <motion.button
                key={t.id}
                initial={false}
                whileHover={shouldAnimateGrid ? { scale: 1.04 } : undefined}
                onDoubleClick={() => playQueue(tracks, i)}
                className="flex flex-col gap-2 text-left group"
              >
                <div className="w-full aspect-square rounded-xl bg-elevated border border-border overflow-hidden flex items-center justify-center">
                  {src ? <FadeImg src={src} className="w-full h-full object-cover" /> : <Music size={28} className="text-muted" />}
                </div>
                <div>
                  <p className="text-xs font-medium text-white truncate">{t.title}</p>
                  <p className="text-xs text-muted truncate">{t.artist}</p>
                </div>
              </motion.button>
            )
          })}
        </div>
      )}

      {libraryMode === 'simple' && (hasMore || loading) && (
        <div ref={loadMoreRef} className="flex justify-center pt-2 min-h-10">
          {loading && tracks.length > 0 && <p className="text-xs text-muted">{t("Loading more tracks...")}</p>}
        </div>
      )}

      {libraryMode === 'simple' && loaded && !loading && !tracks.length && (
        <div className="text-center py-24 text-muted">
          <Music size={48} className="mx-auto mb-4 opacity-20" />
          <p>{problemsOnly ? t('No songs with errors: everything here can be played.') : source === 'all' && !genre && !quality ? t('No tracks yet — pick your music folder above.') : quality ? t('No songs of this quality with these filters.') : genre ? `No ${genre} songs${source === 'all' ? '' : ' from this source'}.` : t('No songs from this source.')}</p>
          {genre && (
            <button onClick={() => setGenre('')} className="mt-3 text-xs text-accent transition-colors hover:text-accent/70">{t("Show all genres")}</button>
          )}
          {quality && (
            <button onClick={() => setQuality('')} className="mt-3 ml-3 text-xs text-accent transition-colors hover:text-accent/70">{t("Show all qualities")}</button>
          )}
        </div>
      )}
    </div>
  )
}
