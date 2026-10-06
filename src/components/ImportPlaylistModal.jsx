import React, { useEffect, useMemo, useState } from 'react'
import { FileUp, Link2, Loader2 } from 'lucide-react'
import Modal from './Modal'
import { api } from '../api'
import { useAppStore } from '../store/player'
import { showToast } from './Toaster'
import { plural } from '../plural'
import { FILE_PLATFORMS, formatDuration } from '../playlistImport'

const input = 'w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-subtle outline-none focus:border-accent/60 transition-colors'
const label = 'text-xs font-display text-muted uppercase tracking-widest block mb-1.5'
const primary = 'py-2.5 px-4 bg-accent text-base rounded-xl text-sm font-medium hover:bg-accent-dim transition-colors disabled:opacity-40'
const secondary = 'py-2.5 px-4 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors disabled:opacity-40'

function Tab({ active, icon: Icon, children, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${active ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border text-muted hover:text-white'}`}>
      <Icon size={13} /> {children}
    </button>
  )
}

function LinkImport({ onDone }) {
  const user = useAppStore(s => s.user)
  const [url, setUrl] = useState('')
  const [reading, setReading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [name, setName] = useState('')
  const [downloadAfter, setDownloadAfter] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  const read = async () => {
    if (!url.trim() || reading) return
    setReading(true)
    setError('')
    setPreview(null)
    const result = await api.previewLinkPlaylist({ url: url.trim() }).catch(e => ({ error: e.message }))
    setReading(false)
    if (result?.error) { setError(result.error); return }
    setPreview(result)
    setSelected(new Set(result.entries.map(e => e.key)))
    setName(result.title || '')
  }

  const chosen = useMemo(() => (preview?.entries || []).filter(e => selected.has(e.key)), [preview, selected])
  const ghostCount = chosen.filter(e => e.status !== 'In library').length

  const toggle = (key) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const submit = async () => {
    if (!name.trim()) { setError('Please enter a playlist name'); return }
    if (!chosen.length) { setError('Pick at least one track'); return }
    setImporting(true)
    setError('')
    const result = await api.importLinkPlaylist({
      name: name.trim(),
      userId: user?.id || 'guest',
      entries: chosen,
      downloadAfter,
    }).catch(e => ({ error: e.message }))
    setImporting(false)
    if (result?.error) { setError(result.error); return }
    onDone(result)
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={label}>Playlist link</label>
        <div className="flex gap-2">
          <input autoFocus value={url} onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') read() }}
            placeholder="https://www.youtube.com/playlist?list=…" className={input} />
          <button type="button" onClick={read} disabled={!url.trim() || reading} className={`${primary} flex flex-shrink-0 items-center gap-2`}>
            {reading && <Loader2 size={14} className="animate-spin" />} Read
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted">YouTube, YouTube Music, SoundCloud and Bandcamp playlists and albums. Nothing is downloaded; songs you don't own are added as streamable ghost songs.</p>
      </div>

      {preview && (
        <>
          <div>
            <label className={label}>Playlist name</label>
            <input value={name} onChange={e => setName(e.target.value)} className={input} />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className={`${label} mb-0`}>{plural(preview.total, 'track')} · {preview.matched} in library</span>
              <span className="flex gap-3 text-[11px] text-muted">
                <button type="button" className="hover:text-white" onClick={() => setSelected(new Set(preview.entries.map(e => e.key)))}>All</button>
                <button type="button" className="hover:text-white" onClick={() => setSelected(new Set())}>None</button>
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-border bg-card/60 divide-y divide-border/60">
              {preview.entries.map(entry => (
                <label key={entry.key} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-elevated/60">
                  <input type="checkbox" checked={selected.has(entry.key)} onChange={() => toggle(entry.key)} style={{ accentColor: 'var(--accent)' }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-white">{entry.title}</span>
                    <span className="block truncate text-[11px] text-muted">{entry.artist || 'Unknown Artist'}{entry.duration ? ` · ${formatDuration(entry.duration)}` : ''}</span>
                  </span>
                  <span className={`flex-shrink-0 text-[10px] ${entry.status === 'In library' ? 'text-accent' : 'text-subtle'}`}>{entry.status}</span>
                </label>
              ))}
            </div>
            {(preview.skipped > 0 || preview.truncated) && (
              <p className="mt-1.5 text-[11px] text-muted">
                {preview.skipped > 0 && `${plural(preview.skipped, 'deleted, private or duplicate video')} left out. `}
                {preview.truncated && 'Only the first 500 tracks are read.'}
              </p>
            )}
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 text-xs text-muted">
            <input type="checkbox" checked={downloadAfter} onChange={e => setDownloadAfter(e.target.checked)} className="mt-0.5" />
            <span>Also download the {plural(ghostCount, 'song')} not in the library yet. Each file takes its ghost song's place in the playlist.</span>
          </label>
        </>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {preview && (
        <button type="button" onClick={submit} disabled={importing || !chosen.length} className={`${primary} w-full flex items-center justify-center gap-2`}>
          {importing && <Loader2 size={14} className="animate-spin" />} Import {plural(chosen.length, 'track')}
        </button>
      )}
    </div>
  )
}

function FileImport({ onDone }) {
  const user = useAppStore(s => s.user)
  const [platform, setPlatform] = useState('spotify')
  const [files, setFiles] = useState([])
  const [preview, setPreview] = useState(null)
  const [name, setName] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  const choose = async () => {
    setError('')
    const selected = await api.openFile({
      filters: [{ name: 'Import Files', extensions: ['csv', 'json', 'm3u', 'm3u8'] }],
      multiple: true,
    })
    const paths = Array.isArray(selected) ? selected : (selected ? [selected] : [])
    if (!paths.length) return
    try {
      const read = await Promise.all(paths.map(async (fp) => {
        const fileContent = await api.readFileBinary(fp)
        const ext = fp.split('.').pop().toLowerCase()
        return { fileName: fp.split(/[/\\]/).pop(), fileContent, fileType: ext === 'm3u8' ? 'm3u' : ext }
      }))
      const result = await api.previewExternalPlaylistImport({ files: read, sourcePlatform: platform })
      if (result?.error) { setError(result.error); setPreview(null); return }
      setFiles(read)
      setPreview(result)
      if (!name.trim()) setName(read[0].fileName.replace(/\.[^.]+$/, ''))
    } catch (e) {
      setError('Error reading file: ' + e.message)
      setPreview(null)
    }
  }

  const submit = async () => {
    if (!name.trim()) { setError('Please enter a playlist name'); return }
    if (!files.length) { setError('Choose one or more CSV, JSON, or M3U files'); return }
    setImporting(true)
    setError('')
    const result = await api.importExternalPlaylist({
      name: name.trim(),
      userId: user?.id || 'guest',
      files,
      sourcePlatform: platform,
    }).catch(e => ({ error: e.message }))
    setImporting(false)
    if (result?.error) { setError(result.error); return }
    onDone(result)
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={label}>Exported from</label>
        <select value={platform} onChange={e => setPlatform(e.target.value)} className={input}>
          {FILE_PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <label className={label}>Files</label>
        <button type="button" onClick={choose} className={`${secondary} w-full flex items-center justify-center gap-2`}>
          <FileUp size={14} /> {files.length ? (files.length === 1 ? files[0].fileName : `${files.length} files selected`) : 'Choose CSV, JSON or M3U files'}
        </button>
        <p className="mt-1.5 text-[11px] text-muted">Songs in your library are matched and their missing details filled in from the file. The rest become ghost songs.</p>
      </div>
      {preview && (
        <>
          <div>
            <label className={label}>Playlist name</label>
            <input value={name} onChange={e => setName(e.target.value)} className={input} />
          </div>
          <p className="text-xs text-muted">{plural(preview.total, 'track')} found · {preview.matched} already in your library · {preview.ghostable} will be ghost songs</p>
        </>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {preview && (
        <button type="button" onClick={submit} disabled={importing || !preview.total} className={`${primary} w-full flex items-center justify-center gap-2`}>
          {importing && <Loader2 size={14} className="animate-spin" />} Import playlist
        </button>
      )}
    </div>
  )
}

export default function ImportPlaylistModal() {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState('link')
  const [session, setSession] = useState(0)

  useEffect(() => {
    const handler = (e) => {
      setSource(e?.detail?.source === 'file' ? 'file' : 'link')
      setSession(n => n + 1)
      setOpen(true)
    }
    window.addEventListener('lokal:playlist-import', handler)
    return () => window.removeEventListener('lokal:playlist-import', handler)
  }, [])

  const done = (result) => {
    setOpen(false)
    window.dispatchEvent(new CustomEvent('lokal:playlist-created', { detail: { playlistId: result.playlistId } }))
    showToast(`Imported ${plural(result.total || 0, 'track')}${result.ghosted ? ` (${result.ghosted} ghost)` : ''}`)
  }

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Import playlist" width="max-w-lg">
      <div className="space-y-4">
        <div className="flex gap-2">
          <Tab active={source === 'link'} icon={Link2} onClick={() => setSource('link')}>From a link</Tab>
          <Tab active={source === 'file'} icon={FileUp} onClick={() => setSource('file')}>From a file</Tab>
        </div>
        {source === 'link' ? <LinkImport key={`l${session}`} onDone={done} /> : <FileImport key={`f${session}`} onDone={done} />}
      </div>
    </Modal>
  )
}
