// Under YouTube Music's songs on the Search page: the artist channels and
// playlists (albums included) matching the search, each downloadable whole
// into the library, then followed right there.

import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle, Download, ExternalLink, Library, RefreshCw, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { artistPath } from '../releaseActions'
import { api } from '../api'
import { useDownloads, isActive } from '../store/downloads'
import { artistResultKey, normalizeArtistResults } from '../downloadLinks'
import { useTranslation } from '../i18n'

const DEBOUNCE_MS = 600

export default function OnlineCollections({ query }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const q = String(query || '').trim()
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const seqRef = useRef(0)
  const jobs = useDownloads(s => s.jobs)
  const enqueue = useDownloads(s => s.enqueue)

  const fetchPage = async (text, pageNo) => {
    const response = await Promise.resolve(api.searchYTArtist(text, pageNo)).catch(e => ({ error: e.message }))
    if (response?.error) return { error: response.error }
    return { results: normalizeArtistResults(Array.isArray(response) ? response : response?.results || []), hasMore: Boolean(response?.hasMore) }
  }

  useEffect(() => {
    const seq = ++seqRef.current
    setItems([]); setError(''); setHasMore(false); setPage(1)
    if (q.length < 2) { setLoading(false); return undefined }
    setLoading(true)
    const t = setTimeout(async () => {
      const got = await fetchPage(q, 1)
      if (seq !== seqRef.current) return
      setItems(got.results || [])
      setHasMore(!!got.hasMore)
      setError(got.error || '')
      setLoading(false)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q])

  const more = async () => {
    if (loadingMore) return
    const seq = seqRef.current
    setLoadingMore(true)
    const got = await fetchPage(q, page + 1)
    setLoadingMore(false)
    if (seq !== seqRef.current || got.error) return
    setItems(current => normalizeArtistResults([...current, ...(got.results || [])]))
    setHasMore(!!got.hasMore)
    setPage(p => p + 1)
  }

  const [failed, setFailed] = useState({}) // url -> error, for a download that couldn't start
  // Being queued (a second click meanwhile would queue it twice).
  const [starting, setStarting] = useState(() => new Set())
  const download = async (item) => {
    if (starting.has(item.url)) return
    setStarting(current => new Set(current).add(item.url))
    setFailed(f => ({ ...f, [item.url]: null }))
    const result = await enqueue('playlist', item.url, { title: item.title, from: 'Search', thumbnail: item.thumbnail || undefined }).catch(e => ({ error: e.message }))
    setStarting(current => { const next = new Set(current); next.delete(item.url); return next })
    if (result?.error) setFailed(f => ({ ...f, [item.url]: result.error }))
  }

  if (q.length < 2 || (!loading && !items.length)) return null

  const channels = items.filter(item => item.type === 'channel')
  const playlists = items.filter(item => item.type !== 'channel')

  return (
    <section className="mt-6" aria-label={t('Online artists and playlists')}>
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-display uppercase tracking-widest text-muted">
        {t('Online artists and playlists')}
        {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />}
      </h3>
      {error && !items.length && <p className="text-xs text-muted">{error}</p>}

      {channels.length > 0 && (
        <section aria-label={t('Artists')} className="mb-6">
          <h4 className="mb-3 text-xs font-display uppercase tracking-widest text-muted">{t('Artists')}</h4>
          <div className="grid grid-cols-3 gap-x-3 gap-y-5 @sm:grid-cols-5 @md:grid-cols-6">
            {channels.map((item, i) => {
              const job = jobs.find(j => !j.removed && j.kind === 'playlist' && j.url === item.url)
              const active = isActive(job) || starting.has(item.url)
              const done = job?.status === 'done'
              const problem = failed[item.url] || (job?.status === 'error' ? job.error || t('Failed') : null)
              const openArtist = () => navigate(artistPath(item.title), { state: { name: item.title } })
              return (
                <motion.div
                  key={artistResultKey(item)}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.025 }}
                  className="group flex min-w-0 flex-col items-center gap-2 text-center"
                >
                  <div className="relative aspect-square w-full max-w-36">
                    <button type="button" onClick={openArtist} title={t('Open artist {name}', { name: item.title })}
                      aria-label={t('Open artist {name}', { name: item.title })}
                      className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full border border-border bg-elevated text-muted transition-all hover:border-accent/50 hover:shadow-lg hover:shadow-black/20">
                      {item.thumbnail
                        ? <img src={item.thumbnail} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" referrerPolicy="no-referrer" />
                        : <UserRound size={28} />}
                      <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                        <ExternalLink size={18} />
                      </span>
                    </button>
                    <button type="button" onClick={() => download(item)} disabled={active || done}
                      title={done ? t('Downloaded to your library') : active ? job?.message || t('Downloading…') : t('Download all of {title} to your library', { title: item.title })}
                      aria-label={done ? t('{title} downloaded', { title: item.title }) : t('Download all of {title}', { title: item.title })}
                      className={`absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border border-border shadow-lg transition-all focus:opacity-100 disabled:cursor-default ${done ? 'bg-card text-green-400 opacity-100' : active ? 'bg-card text-accent opacity-100' : 'bg-accent text-[rgb(var(--bg-rgb))] opacity-0 group-hover:opacity-100'}`}>
                      {done ? <CheckCircle size={14} /> : active ? <RefreshCw size={13} className="animate-spin" /> : <Download size={14} />}
                    </button>
                  </div>
                  <button type="button" onClick={openArtist} title={item.title}
                    className="w-full truncate text-xs font-medium text-text transition-colors hover:text-accent @md:text-sm">
                    {item.title}
                  </button>
                  <p className="w-full truncate text-[10px] text-muted">
                    {item.videoCount ? t('{count} videos', { count: item.videoCount }) : t('Artist')}
                  </p>
                  {problem && <p className="w-full truncate text-[10px] text-red-400" title={problem}>{problem}</p>}
                </motion.div>
              )
            })}
          </div>
        </section>
      )}

      {playlists.length > 0 && (
        <section aria-label={t('Playlists')}>
          <h4 className="mb-3 text-xs font-display uppercase tracking-widest text-muted">{t('Playlists')}</h4>
          <div className="grid gap-2 @sm:grid-cols-2 @xl:grid-cols-3">
            {playlists.map((item, i) => {
              const job = jobs.find(j => !j.removed && j.kind === 'playlist' && j.url === item.url)
              const active = isActive(job) || starting.has(item.url)
              const done = job?.status === 'done'
              const problem = failed[item.url] || (job?.status === 'error' ? job.error || t('Failed') : null)
              return (
                <motion.div
                  key={artistResultKey(item)}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 8) * 0.025 }}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-elevated/50 p-2.5 transition-colors hover:border-accent/30"
                >
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-card text-muted">
                    {item.thumbnail
                      ? <img src={item.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                      : <Library size={18} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text" title={item.title}>{item.title}</p>
                    <p className="truncate text-xs text-muted">
                      {t('Playlist')}
                      {item.channel && item.channel !== item.title ? ` · ${item.channel}` : ''}
                      {item.videoCount ? ` · ${t('{count} videos', { count: item.videoCount })}` : ''}
                    </p>
                    {problem && <p className="truncate text-[11px] text-red-400" title={problem}>{problem}</p>}
                  </div>
                  <button
                    onClick={() => download(item)}
                    disabled={active || done}
                    title={done ? t('Downloaded to your library') : active ? job?.message || t('Downloading…') : t('Download all of {title} to your library', { title: item.title })}
                    aria-label={done ? t('{title} downloaded', { title: item.title }) : t('Download all of {title}', { title: item.title })}
                    className={`flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors ${done ? 'text-green-400' : active ? 'text-accent' : 'bg-accent/15 text-accent hover:bg-accent/25'}`}
                  >
                    {done ? <CheckCircle size={14} /> : active ? <RefreshCw size={13} className="animate-spin" /> : <><Download size={13} /> {t('All')}</>}
                  </button>
                </motion.div>
              )
            })}
          </div>
        </section>
      )}

      {hasMore && (
        <button onClick={more} disabled={loadingMore}
          className="mt-3 text-xs text-muted transition-colors hover:text-text disabled:opacity-50">
          {loadingMore ? t('Loading…') : t('Show more')}
        </button>
      )}
    </section>
  )
}
