// Under YouTube Music's songs on the Search page: the artist channels and
// playlists (albums included) matching the search, each downloadable whole
// into the library, then followed right there.

import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle, Download, Library, RefreshCw, UserRound } from 'lucide-react'
import { api } from '../api'
import { useDownloads, isActive } from '../store/downloads'
import { normalizeArtistResults } from '../downloadLinks'

const DEBOUNCE_MS = 600

export default function OnlineCollections({ query }) {
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

  return (
    <section className="mt-6" aria-label="Playlists and channels">
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-display uppercase tracking-widest text-muted">
        Playlists &amp; channels
        {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />}
      </h3>
      {error && !items.length && <p className="text-xs text-muted">{error}</p>}
      <div className="grid gap-2 @sm:grid-cols-2 @xl:grid-cols-3">
        {items.map((item, i) => {
          const job = jobs.find(j => !j.removed && j.kind === 'playlist' && j.url === item.url)
          const active = isActive(job) || starting.has(item.url)
          const done = job?.status === 'done'
          const problem = failed[item.url] || (job?.status === 'error' ? job.error || 'Failed' : null)
          return (
            <motion.div
              key={`${item.type}-${item.id || item.url}`}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.025 }}
              className="group flex items-center gap-3 rounded-xl border border-border bg-elevated/50 p-2.5 transition-colors hover:border-accent/30"
            >
              <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden bg-card text-muted ${item.type === 'channel' ? 'rounded-full' : 'rounded-lg'}`}>
                {item.thumbnail
                  ? <img src={item.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                  : item.type === 'channel' ? <UserRound size={18} /> : <Library size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text" title={item.title}>{item.title}</p>
                <p className="truncate text-xs text-muted">
                  <span className="capitalize">{item.type}</span>
                  {item.channel && item.channel !== item.title ? ` · ${item.channel}` : ''}
                  {item.videoCount ? ` · ${item.videoCount} videos` : ''}
                </p>
                {problem && <p className="truncate text-[11px] text-red-400" title={problem}>{problem}</p>}
              </div>
              <button
                onClick={() => download(item)}
                disabled={active || done}
                title={done ? 'Downloaded to your library' : active ? job?.message || 'Downloading…' : `Download all of ${item.title} to your library`}
                aria-label={done ? `${item.title} downloaded` : `Download all of ${item.title}`}
                className={`flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors ${done ? 'text-green-400' : active ? 'text-accent' : 'bg-accent/15 text-accent hover:bg-accent/25'}`}
              >
                {done ? <CheckCircle size={14} /> : active ? <RefreshCw size={13} className="animate-spin" /> : <><Download size={13} /> All</>}
              </button>
            </motion.div>
          )
        })}
      </div>
      {hasMore && (
        <button onClick={more} disabled={loadingMore}
          className="mt-3 text-xs text-muted transition-colors hover:text-text disabled:opacity-50">
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      )}
    </section>
  )
}
