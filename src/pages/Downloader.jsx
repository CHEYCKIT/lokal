import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, Download, CheckCircle, AlertTriangle, RefreshCw, Library, UserRound, Link2, Clock } from 'lucide-react'
import { api } from '../api'
import { useDownloads, startDownloadSync, isActive } from '../store/downloads'
import { DownloadList } from '../components/DownloadManager'
import SoulseekSearch from '../components/SoulseekSearch'

const DISCLAIMER_KEY = 'lokal-dl-accepted'

function fmt(seconds) {
  if (!seconds) return ''
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

function prettifySlug(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase())
}

function inferTitleFromUrl(url, fallback = 'Download') {
  if (!url) return fallback
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    const listId = parsed.searchParams.get('list')

    if (host.includes('youtube') || host === 'youtu.be') {
      if (parsed.pathname.includes('/channel/') || parsed.pathname.includes('/c/') || parsed.pathname.includes('/@')) {
        const segment = parsed.pathname.split('/').filter(Boolean).pop()
        return segment ? prettifySlug(segment.replace(/^@/, '')) : 'YouTube Channel'
      }
      if (listId) return `YouTube Playlist ${listId.slice(0, 8)}`
      if (parsed.pathname.includes('/playlist')) return 'YouTube Playlist'
      if (parsed.pathname.includes('/watch')) return 'YouTube Track'
      if (parsed.hostname.includes('music.youtube')) return 'YouTube Music Release'
      return 'YouTube Download'
    }

    if (host.includes('soundcloud')) return 'SoundCloud Download'
    if (host.includes('bandcamp')) return 'Bandcamp Download'
    return prettifySlug(host.split('.').slice(0, -1).join(' ')) || fallback
  } catch {
    return fallback
  }
}

function isGenericTitle(title) {
  const normalized = String(title || '').trim().toLowerCase()
  return !normalized || normalized === 'download' || normalized === 'playlist / album'
}

function displayTitle(item, fallback = 'Download') {
  if (!item) return fallback
  if (!isGenericTitle(item.title) && item.title !== item.url) return item.title
  return inferTitleFromUrl(item.url, fallback)
}

function normalizeArtistResults(items) {
  const seen = new Set()
  return (Array.isArray(items) ? items : [])
    .filter(item => item?.title && item?.url && (item.type === 'channel' || item.type === 'playlist'))
    .filter(item => {
      const key = `${item.type}:${item.id || item.url}:${item.url}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

// Honest formats: nothing claims to be better than the source it came from.
const FORMATS = [
  { id: 'original', label: 'Original', hint: 'The source audio as-is (Opus or AAC on YouTube), no re-encoding. Best quality, smallest files.' },
  { id: 'mp3', label: 'MP3', hint: 'Re-encoded to MP3 for players and devices that need it.' },
  { id: 'm4a', label: 'M4A', hint: 'AAC in an M4A file, copied without re-encoding when the source is AAC.' },
  { id: 'opus', label: 'Opus', hint: 'Opus, copied without re-encoding when the source is Opus (most of YouTube).' },
]

export default function Downloader() {
  const [accepted] = useState(() => localStorage.getItem(DISCLAIMER_KEY) === '1')
  const [showDisclaimer, setShowDisclaimer] = useState(!accepted)
  const [tab, setTab] = useState('search')
  const [downloadedPlaylists, setDownloadedPlaylists] = useState([])
  const [loadingPlaylists, setLoadingPlaylists] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchPage, setSearchPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [artistQuery, setArtistQuery] = useState('')
  const [artistResults, setArtistResults] = useState([])
  const [searchingArtist, setSearchingArtist] = useState(false)
  const [artistPage, setArtistPage] = useState(1)
  const [artistHasMore, setArtistHasMore] = useState(false)
  const [loadingMoreArtist, setLoadingMoreArtist] = useState(false)
  const [artistError, setArtistError] = useState('')
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [format, setFormatState] = useState('mp3')
  const [quality, setQualityState] = useState('320')
  const [queueError, setQueueError] = useState('')
  const downloads = useDownloads(state => state.jobs)
  const { enqueue, load: refreshQueue, cancelAll, clearFinished, markSeen } = useDownloads.getState()

  const manualPlaylistTitle = inferTitleFromUrl(playlistUrl, 'Playlist / Album')
  const activeDownloads = downloads.filter(isActive)

  useEffect(() => {
    startDownloadSync()
    refreshQueue()
    api.getSettings().then(settings => {
      const saved = String(settings?.download_format || 'mp3')
      setFormatState(FORMATS.some(f => f.id === saved) ? saved : 'original')
      if (settings?.download_quality) setQualityState(String(settings.download_quality))
    }).catch(() => {})
  }, [])

  // Being on this page counts as having seen how the downloads ended.
  useEffect(() => { markSeen() }, [downloads])

  const setFormat = (value) => {
    setFormatState(value)
    Promise.resolve(api.saveSettings({ download_format: value })).catch(() => {})
  }
  const setQuality = (value) => {
    setQualityState(value)
    Promise.resolve(api.saveSettings({ download_quality: value })).catch(() => {})
  }

  const search = async (page = 1) => {
    if (!query.trim()) return
    if (page === 1) {
      setResults([])
      setSearchError('')
    }
    setSearching(page === 1)
    const response = await api.searchYTPaginated(query, page)
    if (response?.error) {
      setResults([])
      setHasMore(false)
      setSearchError(response.error)
      setSearching(false)
      return
    }
    const nextResults = Array.isArray(response) ? response : response?.results || []
    setResults(prev => page === 1 ? nextResults : [...prev, ...nextResults])
    setSearchPage(page)
    setHasMore(Boolean(response?.hasMore))
    setSearching(false)
  }

  const loadMore = async () => {
    if (!query.trim() || loadingMore || !hasMore) return
    setLoadingMore(true)
    await search(searchPage + 1)
    setLoadingMore(false)
  }

  const searchArtist = async (page = 1) => {
    if (!artistQuery.trim()) return
    if (page === 1) {
      setArtistResults([])
      setArtistError('')
    }
    setSearchingArtist(page === 1)
    const response = await api.searchYTArtist(artistQuery, page)
    if (response?.error) {
      setArtistResults([])
      setArtistHasMore(false)
      setArtistError(response.error)
      setSearchingArtist(false)
      return
    }
    const nextResults = normalizeArtistResults(Array.isArray(response) ? response : response?.results || [])
    setArtistResults(prev => page === 1 ? nextResults : normalizeArtistResults([...prev, ...nextResults]))
    setArtistPage(page)
    setArtistHasMore(Boolean(response?.hasMore))
    setSearchingArtist(false)
  }

  const loadMoreArtist = async () => {
    if (!artistQuery.trim() || loadingMoreArtist || !artistHasMore) return
    setLoadingMoreArtist(true)
    await searchArtist(artistPage + 1)
    setLoadingMoreArtist(false)
  }

  const reportResult = (result) => {
    setQueueError(result?.error ? result.error : '')
    return !result?.error
  }

  const downloadSingle = async (item) => {
    const result = await enqueue('single', item.url, {
      format,
      quality,
      title: displayTitle(item),
      thumbnail: item.thumbnail || undefined,
      from: 'Search',
    })
    reportResult(result)
  }

  const downloadPlaylistFn = async (url, title = 'Playlist / Album', extra = {}) => {
    if (!url?.trim()) return
    const resolvedTitle = isGenericTitle(title) ? inferTitleFromUrl(url, 'Playlist / Album') : title
    const result = await enqueue('playlist', url.trim(), { format, quality, title: resolvedTitle, ...extra })
    if (reportResult(result) && tab === 'library') loadDownloadedPlaylists()
  }

  const loadDownloadedPlaylists = () => {
    setLoadingPlaylists(true)
    api.getDownloadedPlaylists()
      .then(response => {
        setDownloadedPlaylists(Array.isArray(response) ? response : [])
        setLoadingPlaylists(false)
      })
      .catch(() => setLoadingPlaylists(false))
  }

  const handleRedownload = async (playlistId) => {
    reportResult(await api.redownloadPlaylist(playlistId))
    refreshQueue()
    loadDownloadedPlaylists()
  }

  const handleRemovePlaylist = (playlistId) => {
    if (!confirm('Delete this playlist from library?')) return
    api.deleteDownloadedPlaylist(playlistId).then(() => loadDownloadedPlaylists())
  }

  if (showDisclaimer) {
    return (
      <div className="max-w-lg p-8">
        <div className="overflow-hidden rounded-[28px] border border-yellow-500/20 bg-gradient-to-br from-yellow-500/10 via-card to-card shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div className="border-b border-yellow-500/15 px-6 py-5">
            <h1 className="font-display text-lg uppercase tracking-[0.35em] text-white">Downloader</h1>
          </div>
          <div className="space-y-5 px-6 py-6">
            <div className="flex gap-3">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-yellow-400" />
              <div>
                <p className="mb-2 text-sm font-medium text-yellow-300">Legal Notice</p>
                <p className="text-sm leading-relaxed text-muted">This tool downloads audio via yt-dlp. Only download content you own or are allowed to save. Copyright rules depend on your location and the source.</p>
              </div>
            </div>
            <button
              onClick={() => {
                localStorage.setItem(DISCLAIMER_KEY, '1')
                setShowDisclaimer(false)
              }}
              className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-base transition-colors hover:bg-accent/80"
            >
              I Understand
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-6 px-4 pb-12 pt-6 lg:max-w-[58rem]">
      <section className="rounded-[24px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-lg uppercase tracking-[0.28em] text-white">Downloader</h1>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {[['search', 'Search'], ['artist', 'Artist'], ['playlist', 'Playlist / Album'], ['soulseek', 'Soulseek'], ['library', 'Library']].map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setTab(id)
                  if (id === 'library') loadDownloadedPlaylists()
                }}
                className={`rounded-full px-4 py-2 text-xs font-display uppercase tracking-[0.2em] transition-all ${tab === id ? 'bg-accent text-base' : 'border border-border bg-card/70 text-muted hover:text-white'}`}
              >
                {label}
              </button>
            ))}
            <button onClick={refreshQueue} className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-2 text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-white">
              <RefreshCw size={13} />
              Refresh
            </button>
          </div>
        </div>
      </section>

      {/* Soulseek files arrive as the uploader shared them; formats are for YouTube & co. */}
      {tab !== 'soulseek' && tab !== 'library' && (
        <section className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-display uppercase tracking-[0.26em] text-muted">Format</span>
              {FORMATS.map(option => (
                <button
                  key={option.id}
                  onClick={() => setFormat(option.id)}
                  title={option.hint}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${format === option.id ? 'bg-accent text-base' : 'border border-border text-muted hover:text-white'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {format === 'mp3' && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-display uppercase tracking-[0.26em] text-muted">Bitrate</span>
                {['128', '192', '320'].map(option => (
                  <button
                    key={option}
                    onClick={() => setQuality(option)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${quality === option ? 'border border-accent/30 bg-accent/15 text-accent' : 'border border-border text-muted hover:text-white'}`}
                  >
                    {option}k
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">{FORMATS.find(f => f.id === format)?.hint}</p>
        </section>
      )}

      {queueError && (
        <p className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{queueError}</p>
      )}

      {tab === 'soulseek' && <SoulseekSearch />}

      {tab === 'search' && (
        <section className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted">
            <Search size={14} />
            <span>Track Search</span>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && search(1)}
                placeholder="Search YouTube tracks..."
                className="w-full rounded-2xl border border-border bg-black/20 py-3 pl-10 pr-4 text-sm text-white outline-none transition-colors focus:border-accent/50 placeholder:text-muted"
              />
            </div>
            <button
              onClick={() => search(1)}
              disabled={searching || !query.trim()}
              className="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-base transition-colors hover:bg-accent/80 disabled:opacity-40"
            >
              {searching ? <RefreshCw size={14} className="animate-spin" /> : 'Search'}
            </button>
          </div>

          {searchError && <p className="mt-3 text-sm text-red-400">{searchError}</p>}

          <div className="mt-4 space-y-3">
            {results.map(result => {
              const matchingDownload = downloads.find(download => download.url === result.url && download.kind === 'single')
              const isDownloading = isActive(matchingDownload)
              const isQueued = matchingDownload?.status === 'queued'
              const isDone = matchingDownload?.status === 'done'

              return (
                <motion.div
                  key={result.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-black/15 p-3"
                >
                  {result.thumbnail && <img src={result.thumbnail} className="h-12 w-16 flex-shrink-0 rounded-xl object-cover" />}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{result.title}</p>
                    <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                      {result.topic && <span title="From the artist's catalogue on YouTube Music: album art and album tags" className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">Song</span>}
                      <span className="truncate">{result.channel}{result.duration ? ` · ${fmt(result.duration)}` : ''}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => !isDownloading && !isDone && downloadSingle(result)}
                    disabled={isDownloading || isDone}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${isDone ? 'text-green-400' : isDownloading ? 'text-muted' : 'bg-accent/15 text-accent hover:bg-accent/25'}`}
                  >
                    {isDone ? <CheckCircle size={13} /> : isQueued ? <Clock size={13} /> : isDownloading ? <RefreshCw size={13} className="animate-spin" /> : <><Download size={12} />Download</>}
                  </button>
                </motion.div>
              )
            })}

            {!results.length && !searching && query && !searchError && (
              <p className="py-8 text-center text-sm text-muted">No results. Try a different search.</p>
            )}

            {hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-2xl border border-border bg-black/15 px-4 py-2 text-sm text-muted transition-colors hover:border-accent/50 hover:text-white disabled:opacity-40"
                >
                  {loadingMore ? <RefreshCw size={14} className="animate-spin" /> : 'Load More'}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {tab === 'playlist' && (
        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted">
              <Link2 size={14} />
              <span>Playlist / Album URL</span>
            </div>
            <div>
              <input
                value={playlistUrl}
                onChange={event => setPlaylistUrl(event.target.value)}
                placeholder="https://www.youtube.com/playlist?list=..."
                className="w-full rounded-2xl border border-border bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent/50 placeholder:text-muted"
              />
            </div>
            <div className="mt-4 rounded-2xl border border-border bg-black/15 p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted">Library Name Preview</p>
              <p className="mt-2 text-lg font-semibold text-white">{manualPlaylistTitle}</p>
              <p className="mt-2 text-sm text-muted">If the source exposes a real playlist title, the backend will replace this preview automatically.</p>
            </div>
            <button
              onClick={() => downloadPlaylistFn(playlistUrl, manualPlaylistTitle, { from: 'Link' })}
              disabled={!playlistUrl.trim()}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-base transition-colors hover:bg-accent/80 disabled:opacity-40"
            >
              <Download size={13} /> Download All
            </button>
          </div>

          <div className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted">
              <Library size={14} />
              <span>Sources</span>
            </div>
            <ul className="space-y-3 text-sm text-muted">
              <li>YouTube playlists, albums, videos, channels, and YouTube Music releases.</li>
              <li>SoundCloud, Bandcamp, Mixcloud, and other sources yt-dlp supports.</li>
              <li>Downloads are saved to your music folder and then indexed into the library.</li>
              <li>Each track gets its lyrics written in (synced, from your lyrics sources) and a square cover.</li>
              <li>Original keeps the source audio untouched; MP3 is for devices that need it.</li>
            </ul>
          </div>
        </section>
      )}

      {tab === 'library' && (
        <section className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted">
            <Library size={14} />
            <span>Downloaded Playlists</span>
          </div>
            {loadingPlaylists ? (
              <p className="text-sm text-muted">Loading...</p>
            ) : downloadedPlaylists.length === 0 ? (
              <p className="text-sm text-muted">No playlists downloaded yet. Download a playlist to see it here.</p>
            ) : (
              <div className="space-y-3">
                {downloadedPlaylists.map(playlist => {
                  const isDownloadingPlaylist = downloads.some(download => (
                    isActive(download) &&
                    download.kind === 'playlist' &&
                    (download.playlistId === playlist.id || (playlist.url && download.url === playlist.url))
                  ))
                  return (
                  <div key={playlist.id} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-black/15 p-4">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{displayTitle(playlist, 'Playlist')}</p>
                      <p className="mt-1 text-xs text-muted">{playlist.downloaded_count || 0} tracks · {playlist.status}</p>
                      {playlist.url ? <p className="mt-2 truncate text-[11px] text-muted">{playlist.url}</p> : null}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRedownload(playlist.id)}
                        disabled={isDownloadingPlaylist}
                        className="rounded-xl bg-accent/15 px-3 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isDownloadingPlaylist ? 'Downloading' : 'Re-download'}
                      </button>
                      <button
                        onClick={() => handleRemovePlaylist(playlist.id)}
                        className="rounded-xl px-3 py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )})}
              </div>
            )}
        </section>
      )}

      {tab === 'artist' && (
        <section className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted">
            <UserRound size={14} />
            <span>Artist Search</span>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <UserRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={artistQuery}
                onChange={event => setArtistQuery(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && searchArtist(1)}
                placeholder="Search artist channels and playlists..."
                className="w-full rounded-2xl border border-border bg-black/20 py-3 pl-10 pr-4 text-sm text-white outline-none transition-colors focus:border-accent/50 placeholder:text-muted"
              />
            </div>
            <button
              onClick={() => searchArtist(1)}
              disabled={searchingArtist || !artistQuery.trim()}
              className="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-base transition-colors hover:bg-accent/80 disabled:opacity-40"
            >
              {searchingArtist ? <RefreshCw size={14} className="animate-spin" /> : 'Search'}
            </button>
          </div>

          {artistError && <p className="mt-3 text-sm text-red-400">{artistError}</p>}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {artistResults.map(item => (
              <motion.div
                key={`${item.type}-${item.id}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-border bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] p-4"
              >
                <div className="flex items-start gap-3">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} className="h-16 w-16 flex-shrink-0 rounded-2xl object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl border border-border bg-black/20">
                      {item.type === 'channel' ? <UserRound size={20} className="text-muted" /> : <Library size={20} className="text-muted" />}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] ${item.type === 'channel' ? 'bg-accent/15 text-accent' : 'bg-white/10 text-white'}`}>
                        {item.type}
                      </span>
                      {item.videoCount ? <span className="text-xs text-muted">{item.videoCount} videos</span> : null}
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold text-white">{item.title}</p>
                    {item.channel && item.channel !== item.title ? <p className="mt-1 truncate text-xs text-muted">{item.channel}</p> : null}
                    <p className="mt-2 truncate text-[11px] text-muted">{item.url}</p>
                  </div>
                </div>
                <button
                  onClick={() => downloadPlaylistFn(item.url, item.title, { from: 'Artist', thumbnail: item.thumbnail || undefined })}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent/15 px-3 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/25"
                >
                  <Download size={12} /> Download To Library
                </button>
              </motion.div>
            ))}

            {!artistResults.length && artistQuery && !searchingArtist && !artistError && (
              <p className="py-8 text-center text-sm text-muted md:col-span-2">No usable artist channels or playlists found for that search.</p>
            )}

            {artistHasMore && (
              <div className="flex justify-center pt-2 md:col-span-2">
                <button
                  onClick={loadMoreArtist}
                  disabled={loadingMoreArtist}
                  className="rounded-2xl border border-border bg-black/15 px-4 py-2 text-sm text-muted transition-colors hover:border-accent/50 hover:text-white disabled:opacity-40"
                >
                  {loadingMoreArtist ? <RefreshCw size={14} className="animate-spin" /> : 'Load More'}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {downloads.length > 0 && (
        <section className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted">
              <Download size={14} />
              <span>Download Queue</span>
              {activeDownloads.length > 0 && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">{activeDownloads.length} active</span>}
            </div>
            <div className="flex items-center gap-3">
              {activeDownloads.length > 0 && (
                <button onClick={cancelAll} className="text-xs uppercase tracking-[0.2em] text-yellow-200 transition-colors hover:text-white">
                  Cancel all
                </button>
              )}
              {downloads.some(download => !isActive(download)) && (
                <button onClick={clearFinished} className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-white">
                  Clear finished
                </button>
              )}
            </div>
          </div>
          <DownloadList jobs={downloads} detailed />
        </section>
      )}
    </div>
  )
}
