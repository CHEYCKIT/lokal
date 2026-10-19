// "Save to library" for a streamed song. Click to save from the current
// provider; right-click to search the same song on any built-in source or an
// installed addon. Saving a result can replace the stream that opened Search.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Check, Download, AlertCircle, ArrowUpCircle } from 'lucide-react'
import { useDownloads } from '../store/downloads'
import { api } from '../api'
import SourceIcon from './SourceIcon'
import { DEFAULT_FIND_ON_SOURCES, orderedFindOnSources, buildFindOnRequest } from '../findOnSources'
import { downloadUrlFor, isGhostTrack, providerLabel as labelOf, saveToLibrary, streamRef, sourceRefKey } from '../onlineTracks'
import { libraryCopy, useLibraryIndex } from '../libraryIndex'

const SAVING = new Set(['queued', 'downloading', 'finishing'])

/**
 * @param track     the ghost track, if it exists already
 * @param getTrack  async () => track, for search results not kept as tracks yet
 * @param source    { provider, id } of the song (needed when there's no track yet)
 * @param meta      { title, artist } (for the Soulseek search when there's no track yet)
 * @param size      icon size
 * @param className extra classes (e.g. hover-only visibility while idle)
 * @param offerUpgrade a low-quality copy in the library can be replaced by this
 *                  version (Search); elsewhere it's just "In your library"
 */
export default function SaveToLibraryButton({ track, getTrack, source, meta, size = 14, className = '', offerUpgrade = false, replaceTrackId = null, openMenuOnEvent = false, openMenuEventKey = null }) {
  const nav = useNavigate()
  const ref = streamRef(track) || source
  const url = ref && (ref.provider === 'yt' || ref.provider === 'sc')
    ? downloadUrlFor({ file_path: `ghost://${ref.provider === 'sc' ? 'soundcloud' : 'youtube'}/online/${ref.id}` })
    : null
  // The download job: by its URL (YouTube, SoundCloud), or by the id we got
  // back when starting it (addon links change on every request).
  const [jobId, setJobId] = useState(null)
  // The download of this song, wherever it was started (a search result, the
  // player bar...): by the song itself (sourceRef), its URL, or the id we got
  // back. A finished download whose song was deleted since doesn't count: it
  // can be saved again.
  const refKey = sourceRefKey(ref) || (getTrack ? `recommendation:${meta?.artist || track?.artist}\0${meta?.title || track?.title}` : null)
  const job = useDownloads(s => s.jobs.find(j => !j.removed && ((refKey && j.sourceRef === refKey) || (url && j.url === url) || (jobId && j.id === jobId))) || null)
  // Already in the library (the download was refused as a duplicate).
  const [inLibrary, setInLibrary] = useState(false)
  // In the library already, downloaded before or a file of the user's own:
  // by where it was downloaded from, or by artist and title (libraryIndex.js).
  const libraryIndex = useLibraryIndex()
  const song = { artist: meta?.artist ?? track?.artist, artists: meta?.artists ?? track?.artists, title: meta?.title ?? track?.title }
  const copy = libraryCopy(libraryIndex, { ref, sourceRef: refKey, ...song })
  // A low-quality copy (a 128 kbps MP3, say) of a search result: this
  // version can be downloaded to replace it. Everywhere else (Home, the
  // player) it's just in the library.
  const upgradable = offerUpgrade && !!copy?.low && !!ref
  const owned = !!copy && !upgradable
  const [requested, setRequested] = useState(false)
  const [error, setError] = useState(null)
  const [menu, setMenu] = useState(null) // { x, y }
  const [menuPosition, setMenuPosition] = useState(null)
  const [findSources, setFindSources] = useState(DEFAULT_FIND_ON_SOURCES)
  const menuRef = useRef(null)
  const externalMenuButtonRef = useRef(null)
  // Another song in the same place (a reused row, the player's next song):
  // nothing of the previous one's state carries over, not even a late answer.
  const keyRef = useRef(refKey)
  useEffect(() => {
    if (keyRef.current === refKey) return
    keyRef.current = refKey
    setInLibrary(false); setRequested(false); setError(null); setJobId(null)
  }, [refKey])

  const state = !error && !job && !requested && !inLibrary && upgradable ? 'upgrade'
    : error || job?.status === 'error' || job?.status === 'missing' ? 'failed'
    : inLibrary || owned ? 'saved'
      : (job && SAVING.has(job.status)) || requested ? 'saving'
        : 'idle'
  useEffect(() => { if (job) setRequested(false) }, [job])

  useEffect(() => {
    if (!openMenuOnEvent) return undefined
    const openFromPlayerMenu = (event) => {
      const eventKey = event.detail?.key
      if (eventKey == null || openMenuEventKey == null || String(eventKey) !== String(openMenuEventKey)) return
      const rect = externalMenuButtonRef.current?.getBoundingClientRect()
      if (!rect) return
      setMenuPosition(null)
      setMenu({ x: rect.left, y: rect.bottom + 4 })
    }
    window.addEventListener('lokal:open-save-source-menu', openFromPlayerMenu)
    return () => window.removeEventListener('lokal:open-save-source-menu', openFromPlayerMenu)
  }, [openMenuOnEvent, openMenuEventKey])

  useEffect(() => {
    if (!menu) return undefined
    let live = true
    Promise.resolve(api.onlineProviders?.())
      .then(list => { if (live && Array.isArray(list)) setFindSources(orderedFindOnSources(list)) })
      .catch(() => {})
    const close = (event) => { if (!menuRef.current?.contains(event.target)) setMenu(null) }
    const onKey = (event) => { if (event.key === 'Escape') setMenu(null) }
    const onBlur = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      live = false
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [menu])

  // Keep the expanded source list inside the app window, including when its
  // height changes after the installed addon list arrives.
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    setMenuPosition({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    })
  }, [menu, findSources])

  if (!ref && !getTrack) return null
  const providerLabel = ref ? (findSources.find(source => source.id === ref.provider)?.label || labelOf(ref.provider)) : 'your playback sources'

  const resolveTrack = async () => getTrack ? await getTrack() : track

  // Only the library check says it's there (not a download of this song):
  // it can still be downloaded from the menu (another version, say).
  const ownedOnly = state === 'saved' && owned && !inLibrary && job?.status !== 'done'

  /** Download from where the song streams. */
  const saveFromSource = async ({ force = false } = {}) => {
    setMenu(null)
    if (state === 'saving' || (state === 'saved' && !(force && ownedOnly))) return
    setError(null)
    setRequested(true)
    const clickedKey = refKey
    const target = await resolveTrack().catch(() => null)
    const result = target?.file_path && !isGhostTrack(target) ? { alreadyInLibrary: true }
      : target ? await saveToLibrary(target, { replaceTrackId: replaceTrackId || undefined }).catch(e => ({ error: e.message })) : { error: 'Could not save this song' }
    if (keyRef.current !== clickedKey) return
    if (result?.alreadyInLibrary) {
      // Nothing to download: the song is in the library, and this streamed
      // copy has just been swapped for it in likes and playlists.
      setRequested(false)
      setInLibrary(true)
      window.dispatchEvent(new Event('lokal:refresh'))
      return
    }
    if (result?.error) { setRequested(false); setError(result.error) }
    else if (result?.downloadId) setJobId(result.downloadId)
    useDownloads.getState().load?.()
  }

  /** Open Search on the selected source, keeping the original stream as the replacement target. */
  const findOnSource = async (provider) => {
    setMenu(null)
    const target = await resolveTrack().catch(() => null)
    const request = buildFindOnRequest(provider.id, target, meta)
    if (replaceTrackId) request.replaceTrackId = replaceTrackId
    nav('/search', { state: { findOn: request } })
  }

  const label = state === 'upgrade' ? 'In your library in low quality: click to download this version (it replaces the file if it\'s better)'
    : ownedOnly ? 'In your library (right-click to download it anyway)'
    : state === 'saved' ? 'Saved to library'
    : state === 'saving' ? 'Saving to your library…'
      : state === 'failed' ? `Couldn't save${error ? `: ${error}` : ''}. Click to try again`
        : `Save to library (right-click to find on another source)`
  const Icon = state === 'saved' ? Check : state === 'failed' ? AlertCircle : state === 'upgrade' ? ArrowUpCircle : Download
  const color = state === 'upgrade' ? 'text-amber-300/80 hover:text-accent'
    : state === 'saved' ? 'text-accent' : state === 'saving' ? 'text-accent animate-pulse' : state === 'failed' ? 'text-red' : 'text-muted hover:text-accent'

  return (
    <>
      <button
        ref={externalMenuButtonRef}
        onClick={(e) => { e.stopPropagation(); saveFromSource() }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenuPosition(null); setMenu({ x: e.clientX, y: e.clientY }) }}
        disabled={state === 'saving' || (state === 'saved' && !ownedOnly)}
        title={label}
        aria-label={label}
        className={`flex-shrink-0 transition-all ${color} ${state === 'idle' ? className : ''}`}
      >
        <Icon size={size} />
      </button>
      {menu && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            left: menuPosition?.left ?? menu.x,
            top: menuPosition?.top ?? menu.y,
            visibility: menuPosition ? 'visible' : 'hidden',
            zIndex: 200,
            maxHeight: 'calc(100vh - 16px)',
            overflowY: 'auto',
          }}
          className="w-60 rounded-xl border border-border bg-elevated py-1 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <button role="menuitem" onClick={() => saveFromSource({ force: true })} disabled={state === 'saving' || (state === 'saved' && !ownedOnly)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-text hover:bg-card disabled:opacity-50">
            <Download size={14} className="text-muted" /> Download from {providerLabel}
          </button>
          <div role="separator" className="my-1 h-px bg-border" />
          {findSources.map(source => (
            <button key={source.id} role="menuitem" onClick={() => findOnSource(source)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-text hover:bg-card">
              {source.addon && source.icon
                ? <img src={source.icon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm object-cover" referrerPolicy="no-referrer" />
                : <SourceIcon source={source.id} size={14} colored />}
              <span className="truncate">Find on {source.label}…</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
