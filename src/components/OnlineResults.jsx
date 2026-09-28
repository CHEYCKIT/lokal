// Online results: songs that aren't in the library, under the local results
// on the Search page, from YouTube Music or SoundCloud (switch in the section
// header, remembered). They stream with the user's yt-dlp; + adds one to a
// playlist and ⬇ saves it to the library (right-click ⬇ for Soulseek). Both
// keep it as a ghost track until the file is in.

import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Music, Pause, Play, Plus } from 'lucide-react'
import { api } from '../api'
import { usePlayerStore, useAppStore } from '../store/player'
import { sameStream } from '../onlineTracks'
import { saveRecentSearch } from '../searchHistory'
import SaveToLibraryButton from './SaveToLibraryButton'

const DEBOUNCE_MS = 450
const PROVIDER_KEY = 'lokal-online-provider'
// Built-in sources; installed addons are added from the backend (online:providers).
const BUILT_IN = [
  { id: 'yt', label: 'YouTube Music' },
  { id: 'sc', label: 'SoundCloud' },
]

function fmtDuration(seconds) {
  const s = Math.round(Number(seconds) || 0)
  if (!s) return ''
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function storedProvider() {
  try { return localStorage.getItem(PROVIDER_KEY) || 'yt' } catch { return 'yt' }
}

/** The sources to switch between (refreshed when addons change in Settings). */
function useProviders() {
  const [providers, setProviders] = useState(BUILT_IN)
  useEffect(() => {
    // Only the latest answer counts: an older one arriving late would bring
    // back an addon removed or turned off since.
    let latest = 0
    const load = () => {
      const seq = ++latest
      return Promise.resolve(api.onlineProviders?.())
        .then(list => { if (seq === latest && Array.isArray(list) && list.length) setProviders(list) })
        .catch(() => {})
    }
    load()
    window.addEventListener('lokal:addons-changed', load)
    return () => window.removeEventListener('lokal:addons-changed', load)
  }, [])
  return providers
}

/** Online songs for `query`, with play / add to playlist / save to library. */
export default function OnlineResults({ query }) {
  const providers = useProviders()
  const [chosen, setProvider] = useState(storedProvider)
  // A removed / turned-off addon falls back to YouTube Music.
  const provider = providers.some(p => p.id === chosen) ? chosen : 'yt'
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const seqRef = useRef(0)
  const { currentTrack, isPlaying, playQueue, togglePlay } = usePlayerStore()
  const { openAddToPlaylist } = useAppStore()
  const q = String(query || '').trim()
  const providerLabel = providers.find(p => p.id === provider)?.label || 'YouTube Music'

  const choose = (id) => {
    setProvider(id)
    try { localStorage.setItem(PROVIDER_KEY, id) } catch {}
  }

  useEffect(() => {
    const seq = ++seqRef.current
    if (q.length < 2) { setResults([]); setLoading(false); setError(null); return undefined }
    setLoading(true)
    setResults([])
    const t = setTimeout(async () => {
      let res
      try { res = await api.onlineSearch(q, provider) } catch (e) { res = { error: e.message } }
      if (seq !== seqRef.current) return
      setResults(Array.isArray(res?.results) ? res.results : [])
      setError(res?.results?.length ? null : res?.error || null)
      setLoading(false)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q, provider])

  if (q.length < 2) return null

  /** Keep the results as ghost tracks (so they can be queued, liked, added). */
  const asTracks = async (items) => {
    const rows = await api.onlineSave(items)
    return Array.isArray(rows) ? rows : []
  }

  const play = async (item, index) => {
    if (currentTrack && sameStream(currentTrack, item)) { togglePlay(); return }
    saveRecentSearch(q)
    const rows = await asTracks(results)
    const target = rows[index]
    if (!target) return
    const queue = rows.filter(Boolean)
    playQueue(queue, queue.findIndex(t => t.id === target.id), { type: 'search', id: q, name: `${providerLabel}: ${q}` })
  }

  const addToPlaylist = async (item) => {
    const [row] = await asTracks([item])
    if (row?.id) openAddToPlaylist(row)
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <h2 className="text-xs font-display text-muted uppercase tracking-widest flex items-center gap-2 flex-shrink-0">
            Online
            {loading && <span className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />}
          </h2>
          <div role="tablist" aria-label="Online source" className="flex items-center gap-1 rounded-full border border-border p-0.5">
            {providers.map(p => (
              <button
                key={p.id}
                role="tab"
                aria-selected={provider === p.id}
                onClick={() => choose(p.id)}
                title={p.addon ? `${p.label} (addon)` : p.label}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${provider === p.id ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text'}`}
              >
                {p.icon && <img src={p.icon} alt="" className="h-3.5 w-3.5 rounded-sm object-cover" referrerPolicy="no-referrer" />}
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <span className="text-[10px] text-muted/80 truncate">{providers.find(p => p.id === provider)?.addon ? 'From an addon you installed' : 'Streams with yt-dlp'} · not in your library</span>
      </div>
      {error && !results.length && <p className="text-xs text-muted py-2">{error}</p>}
      {!loading && !error && !results.length && <p className="text-xs text-muted py-2">No songs found on {providerLabel}.</p>}
      <div className="space-y-0.5">
        {results.map((item, i) => {
          const current = currentTrack && sameStream(currentTrack, item)
          return (
            <motion.div
              key={`${item.provider}:${item.id}`}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 10) * 0.02 }}
              onDoubleClick={() => play(item, i)}
              className={`group grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 px-3 py-1.5 rounded-lg transition-colors ${current ? 'bg-accent/10' : 'hover:bg-elevated'}`}
            >
              <button
                onClick={() => play(item, i)}
                title={current && isPlaying ? 'Pause' : 'Play'}
                aria-label={`${current && isPlaying ? 'Pause' : 'Play'} ${item.title}`}
                className="relative w-10 h-10 rounded overflow-hidden bg-card flex items-center justify-center text-muted"
              >
                {item.thumbnail ? <img src={item.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <Music size={14} />}
                <span className={`absolute inset-0 flex items-center justify-center bg-black/50 text-white transition-opacity ${current ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  {current && isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="translate-x-px" />}
                </span>
              </button>
              <div className="min-w-0">
                <p className={`text-sm font-medium truncate ${current ? 'text-accent' : 'text-text'}`}>{item.title}</p>
                <p className="text-xs text-muted truncate">
                  {[item.artist, item.album].filter(Boolean).join(' · ')}
                  {item.kind === 'video' && <span className="ml-1.5 text-[10px] uppercase tracking-wide opacity-70">Video</span>}
                  {item.quality && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-accent/80">{item.quality}</span>}
                  {item.preview && <span title="SoundCloud only lets non-subscribers play 30 seconds of this track" className="ml-1.5 text-[10px] uppercase tracking-wide text-accent/80">30 s preview</span>}
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <button onClick={() => addToPlaylist(item)} title="Add to playlist" aria-label={`Add ${item.title} to a playlist`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted hover:text-accent transition-all">
                  <Plus size={15} />
                </button>
                <SaveToLibraryButton
                  source={{ provider: item.provider, id: String(item.id) }}
                  meta={{ title: item.title, artist: item.artist }}
                  getTrack={async () => (await asTracks([item]))[0]}
                  size={15}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                />
                <span className="text-xs text-muted font-display w-10 text-right">{fmtDuration(item.duration)}</span>
              </div>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
