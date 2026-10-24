// Online results: songs that aren't in the library, under the local results
// on the Search page, from YouTube Music, SoundCloud, installed addons or
// Soulseek (switch in the section header, remembered). The streaming sources
// play with the user's yt-dlp; + adds one to a playlist and ⬇ saves it to the
// library (right-click ⬇ for Soulseek), both keeping it as a ghost track
// until the file is in. YouTube Music also lists matching playlists and
// channels to download whole; Soulseek lists shared files to download.

import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Music, Pause, Play, Plus } from 'lucide-react'
import { api } from '../api'
import { usePlayerStore, useAppStore } from '../store/player'
import { useShallow } from 'zustand/react/shallow'
import { sameStream } from '../onlineTracks'
import { awaitAtmosOutputRelease, shouldToggleNormalStream } from '../audio/atmosHandoff.mjs'
import { recentTrackItem, saveRecentItem, saveRecentSearch } from '../searchHistory'
import SaveToLibraryButton from './SaveToLibraryButton'
import SoulseekSearch from './SoulseekSearch'
import OnlineCollections from './OnlineCollections'
import DownloadNotices from './DownloadNotices'
import SourceIcon from './SourceIcon'
import AddonCollections from './AddonCollections'
import AddonSetupNotice from './AddonSetupNotice'
import { DEFAULT_SEARCH_SOURCES, orderedFindOnSources } from '../findOnSources'
import { useTranslation } from '../i18n'
import { atmosAvailable, ATMOS_AVAILABLE } from '../quality'
import AtmosPlayButton from './AtmosPlayButton'
import { advertisedQuality } from '../catalogueQuality'
import { showToast } from './Toaster'

let atmosRequestSerial = 0
const DEBOUNCE_MS = 450
const PROVIDER_KEY = 'lokal-online-provider'
// Built-in sources; installed addons are added from the backend (online:providers).
const BUILT_IN = DEFAULT_SEARCH_SOURCES

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

/**
 * Online songs for `query`, with play / add to playlist / save to library.
 * @param soulseekFor  a song to find on Soulseek ("Find on Soulseek…", "Get it
 *                     in lossless"): Soulseek is shown, and the file picked
 *                     there replaces the stream / the track's file
 */
export default function OnlineResults({ query, soulseekFor = null, findOn = null }) {
  const { t } = useTranslation()
  // YouTube Music and SoundCloud, then Soulseek, then installed addons.
  const loaded = useProviders()
  const providers = orderedFindOnSources(loaded)
  const [chosen, setProvider] = useState(storedProvider)
  const sourceRequest = findOn || (soulseekFor ? { ...soulseekFor, provider: 'slsk' } : null)
  const [requestedProvider, setRequestedProvider] = useState(() => sourceRequest?.provider || null)
  useEffect(() => {
    setRequestedProvider(sourceRequest?.provider || null)
  }, [sourceRequest?.provider, sourceRequest?.replaceTrackId, sourceRequest?.upgradeTrackId])
  // A removed / turned-off addon falls back to YouTube Music.
  const provider = providers.some(p => p.id === requestedProvider) ? requestedProvider
    : providers.some(p => p.id === chosen) ? chosen : 'yt'
  const soulseek = provider === 'slsk'
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const seqRef = useRef(0)
  const { currentTrack, isPlaying, playQueue, togglePlay } = usePlayerStore(useShallow(({ currentTrack, isPlaying, playQueue, togglePlay }) => ({ currentTrack, isPlaying, playQueue, togglePlay })))
  const { openAddToPlaylist } = useAppStore()
  const q = String(query || '').trim()
  const providerLabel = providers.find(p => p.id === provider)?.label || 'YouTube Music'

  const choose = (id) => {
    setRequestedProvider(null)
    setProvider(id)
    try { localStorage.setItem(PROVIDER_KEY, id) } catch {}
  }

  useEffect(() => {
    const seq = ++seqRef.current
    if (q.length < 2 || soulseek) { setResults([]); setLoading(false); setError(null); return undefined }
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
  }, [q, provider, soulseek])

  if (q.length < 2) return null

  /** Keep the results as ghost tracks (so they can be queued, liked, added). */
  const asTracks = async (items) => {
    const rows = await api.onlineSave(items)
    return Array.isArray(rows) ? rows : []
  }

  // Atmos is a native output engine, not a second player UI. Place the real
  // track in the same queue/currentTrack that drives bar, fullscreen, mini,
  // SMTC and keyboard transports before asking the native backend to play.
  const playNativeAtmos = async (item, index, mode, device) => {
    const rows = await asTracks(results)
    const target = rows[index]
    if (!target) return { error: 'Could not add the Atmos track to the player' }
    const queue = rows.filter(Boolean)
    const indexInQueue = queue.findIndex(row => row.id === target.id)
    const requestId = ++atmosRequestSerial
    queue[indexInQueue] = {
      ...target, atmosNative: true, atmosMode: mode,
      atmosProvider: item.provider, atmosSourceId: String(item.id),
      atmosRequestId: requestId,
    }
    saveRecentItem(recentTrackItem(target))
    playQueue(queue, indexInQueue, { type: 'search', id: q, name: `${providerLabel}: ${q}` })
    const selected = () => {
      const current = usePlayerStore.getState().currentTrack
      return current?.atmosNative === true &&
        current.atmosSourceId === String(item.id) &&
        current.atmosProvider === item.provider &&
        current.atmosRequestId === requestId
    }
    try {
      await awaitAtmosOutputRelease()
      if (!selected()) return { error: 'Atmos request was superseded by a newer track' }
      const result = await api.atmosPlay(item.provider, String(item.id), device, mode)
      if (!result?.ok) {
        // A late native failure must not pause the stereo/other-provider song
        // that the user has already switched to.
        if (selected()) usePlayerStore.setState({ isPlaying: false, isBuffering: false })
        return result || { error: 'Native Atmos output was refused' }
      }
      if (!selected()) {
        // Backend generations and the queued release barrier already cancel
        // this session. An unconditional stop here could kill a *newer*
        // Atmos request that has since taken the same player/source.
        return { error: 'Atmos request was superseded by a newer track' }
      }
      return result
    } catch (error) {
      if (selected()) usePlayerStore.setState({ isPlaying: false, isBuffering: false })
      return { error: error?.message || String(error) }
    }
  }

  const play = async (item, index) => {
    // Normal Play must always request the ordinary provider stream. An Atmos
    // badge advertises an alternate version; only PLAY ATMOS activates native
    // E-AC-3 JOC. Matching the same source while Atmos owns it must replace
    // the audio backend, not toggle the native session's play/pause state.
    if (shouldToggleNormalStream(currentTrack, sameStream(currentTrack, item))) {
      togglePlay()
      return
    }
    saveRecentSearch(q)
    const rows = await asTracks(results)
    const target = rows[index]
    if (!target) return
    saveRecentItem(recentTrackItem(target))
    const queue = rows.filter(Boolean)
    playQueue(queue, queue.findIndex(row => row.id === target.id),
      { type: 'search', id: q, name: `${providerLabel}: ${q}` })
  }

  const addToPlaylist = async (item) => {
    const [row] = await asTracks([item])
    if (row?.id) openAddToPlaylist(row)
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 mb-3">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <h2 className="text-xs font-display text-muted uppercase tracking-widest flex items-center gap-2 flex-shrink-0">
            Online
            {loading && !soulseek && <span className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />}
          </h2>
          <div role="tablist" aria-label={t('Online source')} className="flex max-w-full flex-wrap items-center gap-1 rounded-2xl border border-border p-0.5">
            {providers.map(p => (
              <button
                key={p.id}
                role="tab"
                aria-selected={provider === p.id}
                onClick={() => choose(p.id)}
                title={p.addon ? t('{source} (add-on)', { source: p.label }) : p.label}
                className={`flex max-w-full min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${provider === p.id ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text'}`}
              >
                 {p.addon && p.icon ? <img src={p.icon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm object-cover" referrerPolicy="no-referrer" /> : <SourceIcon source={p.id} colored />}
                <span className="truncate">{p.label}</span>
                {p.needsSetup && <span title={t('Needs setting up')} aria-label={t('Needs setting up')} className="h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-400" />}
              </button>
            ))}
          </div>
        </div>
        <span className="min-w-0 text-[10px] text-muted/80 truncate">{t(soulseek ? 'Files people share, through slskd' : providers.find(p => p.id === provider)?.addon ? 'From an add-on you installed' : 'Streams with yt-dlp')}{t(' · not in your library')}</span>
      </div>
      <div className="mb-3 empty:hidden"><DownloadNotices youtube={provider === 'yt'} /></div>
      {!soulseek && <AddonSetupNotice source={providers.find(p => p.id === provider)} className="mb-3" />}
      {soulseek ? (
        <SoulseekSearch
          query={q}
          key={sourceRequest?.replaceTrackId || sourceRequest?.upgradeTrackId || 'soulseek'}
          initialLosslessOnly={!!sourceRequest?.losslessOnly}
          replaceTrack={sourceRequest?.replaceTrackId ? sourceRequest : null}
          upgradeTrack={sourceRequest?.upgradeTrackId ? sourceRequest : null}
        />
      ) : (
        <>
        {error && !results.length && <p className="text-xs text-muted py-2">{t(error)}</p>}
        {!loading && !error && !results.length && <p className="text-xs text-muted py-2">{t('No songs found on {source}.', { source: providerLabel })}</p>}
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
                  title={t(current && isPlaying ? 'Pause' : 'Play')}
                  aria-label={t('{action} {title}', { action: t(current && isPlaying ? 'Pause' : 'Play'), title: item.title })}
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
                    {item.kind === 'video' && <span className="ml-1.5 text-[10px] uppercase tracking-wide opacity-70">{t('Video')}</span>}

                    {item.preview && <span title={t('SoundCloud only lets non-subscribers play 30 seconds of this track')} className="ml-1.5 text-[10px] uppercase tracking-wide text-accent/80">{t('30 s preview')}</span>}
                  </p>
                  {(advertisedQuality(item) || atmosAvailable(item)) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]" aria-label={t('Catalogue audio formats')}>
                      {advertisedQuality(item) && <span className="rounded border border-border px-1.5 py-px text-muted" title={t('Catalogue quality (actual playback format can differ)')}>{t(advertisedQuality(item))}</span>}
                      {atmosAvailable(item) && <span className={`rounded border px-1.5 py-px font-semibold ${ATMOS_AVAILABLE.className}`} title={t('Tidal catalogue offers an Atmos version. Playback depends on the stream and output.')}>{t('DOLBY ATMOS')}</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  {atmosAvailable(item) && <AtmosPlayButton track={item} onPlay={(mode, device) => playNativeAtmos(item, i, mode, device)} />}
                  <button onClick={() => addToPlaylist(item)} title={t('Add to playlist')} aria-label={t('Add {title} to a playlist', { title: item.title })}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted hover:text-accent transition-all">
                    <Plus size={15} />
                  </button>
                  <SaveToLibraryButton
                    source={{ provider: item.provider, id: String(item.id) }}
                    meta={{ title: item.title, artist: item.artist, artists: item.artists }}
                    replaceTrackId={sourceRequest?.replaceTrackId}
                    getTrack={async () => (await asTracks([item]))[0]}
                    size={15}
                    offerUpgrade
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                  />
                  <span className="text-xs text-muted font-display w-10 text-right">{fmtDuration(item.duration)}</span>
                </div>
              </motion.div>
            )
          })}
        </div>
        {provider === 'yt' && <OnlineCollections query={q} />}
        {providers.find(source => source.id === provider)?.package && <AddonCollections key={provider} query={q} source={providers.find(source => source.id === provider)} />}
        </>
      )}
    </section>
  )
}
