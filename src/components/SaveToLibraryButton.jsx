// "Save to library" for a streamed song. Click: download it from where it
// streams (YouTube or SoundCloud). Right-click: choose, including "Find on
// Soulseek…", which opens the Soulseek tab searched for the song; the file
// picked there replaces the stream. The button follows the download:
// saving → saved (or failed, click to try again).

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Check, Download, AlertCircle, Search } from 'lucide-react'
import { useDownloads } from '../store/downloads'
import { downloadUrlFor, providerLabel as labelOf, saveToLibrary, streamRef, sourceRefKey } from '../onlineTracks'

const SAVING = new Set(['queued', 'downloading', 'finishing'])

/**
 * @param track     the ghost track, if it exists already
 * @param getTrack  async () => track, for search results not kept as tracks yet
 * @param source    { provider, id } of the song (needed when there's no track yet)
 * @param meta      { title, artist } (for the Soulseek search when there's no track yet)
 * @param size      icon size
 * @param className extra classes (e.g. hover-only visibility while idle)
 */
export default function SaveToLibraryButton({ track, getTrack, source, meta, size = 14, className = '' }) {
  const nav = useNavigate()
  const ref = track ? streamRef(track) : source
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
  const refKey = sourceRefKey(ref)
  const job = useDownloads(s => s.jobs.find(j => !j.removed && ((refKey && j.sourceRef === refKey) || (url && j.url === url) || (jobId && j.id === jobId))) || null)
  // Already in the library (the download was refused as a duplicate).
  const [inLibrary, setInLibrary] = useState(false)
  const [requested, setRequested] = useState(false)
  const [error, setError] = useState(null)
  const [menu, setMenu] = useState(null) // { x, y }
  const menuRef = useRef(null)

  const state = error || job?.status === 'error' || job?.status === 'missing' ? 'failed'
    : inLibrary || job?.status === 'done' ? 'saved'
      : (job && SAVING.has(job.status)) || requested ? 'saving'
        : 'idle'
  useEffect(() => { if (job) setRequested(false) }, [job])

  useEffect(() => {
    if (!menu) return undefined
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(null) }
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', () => setMenu(null), { once: true })
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey) }
  }, [menu])

  if (!ref) return null
  const providerLabel = labelOf(ref.provider)

  const resolveTrack = async () => track || (getTrack ? await getTrack() : null)

  /** Download from where the song streams. */
  const saveFromSource = async () => {
    setMenu(null)
    if (state === 'saving' || state === 'saved') return
    setError(null)
    setRequested(true)
    const target = await resolveTrack().catch(() => null)
    const result = target ? await saveToLibrary(target).catch(e => ({ error: e.message })) : { error: 'Could not save this song' }
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

  /** Open the Soulseek tab searched for this song; the picked file replaces the stream. */
  const findOnSoulseek = async () => {
    setMenu(null)
    const target = await resolveTrack().catch(() => null)
    const title = target?.title || meta?.title || ''
    const artist = target?.artist || meta?.artist || ''
    nav('/downloader', { state: { soulseek: { query: [artist, title].filter(Boolean).join(' ').replace(/\s*\((?:feat|ft)\.?[^)]*\)/i, ''), replaceTrackId: target?.id, title, artist } } })
  }

  const label = state === 'saved' ? 'Saved to library'
    : state === 'saving' ? 'Saving to your library…'
      : state === 'failed' ? `Couldn't save${error ? `: ${error}` : ''}. Click to try again`
        : `Save to library (right-click for Soulseek)`
  const Icon = state === 'saved' ? Check : state === 'failed' ? AlertCircle : Download
  const color = state === 'saved' ? 'text-accent' : state === 'saving' ? 'text-accent animate-pulse' : state === 'failed' ? 'text-red' : 'text-muted hover:text-accent'

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); saveFromSource() }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }) }}
        disabled={state === 'saving' || state === 'saved'}
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
          style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 100), zIndex: 200 }}
          className="w-56 rounded-xl border border-border bg-elevated py-1 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <button role="menuitem" onClick={saveFromSource} disabled={state === 'saving' || state === 'saved'}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-text hover:bg-card disabled:opacity-50">
            <Download size={14} className="text-muted" /> Download from {providerLabel}
          </button>
          <button role="menuitem" onClick={findOnSoulseek}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-text hover:bg-card">
            <Search size={14} className="text-muted" /> Find on Soulseek…
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
