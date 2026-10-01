import React, { useDeferredValue, useEffect, useRef, useState } from 'react'
import { Camera, Check, Merge, Search, Trash2, Undo2 } from 'lucide-react'
import Modal from './Modal'
import SectionSwap, { ReadyWhen } from './SectionSwap'
import AutoHeight from './AutoHeight'
import { api, peekSettings } from '../api'
import { ARTIST_SOURCES } from '../artistSources'
import { plural } from '../plural'

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim()
}

// Lookup lists photos and bios apart, best sources first (as Auto picks).
const PHOTO_RANK = { deezer: 0, theaudiodb: 1, wikidata: 2, musicbrainz: 3, wikipedia: 4 }
const BIO_RANK = { wikidata: 0, theaudiodb: 1, musicbrainz: 2, wikipedia: 3 }
const resultKey = (result) => result.key || `${result.source}:${result.title}`
const sourceLabel = (source) => ARTIST_SOURCES.find(([id]) => id === source)?.[1] || source || 'web'
const byRank = (rank, extra = () => 0) => (a, b) => ((rank[a.source] ?? 9) + extra(a)) - ((rank[b.source] ?? 9) + extra(b))

export default function ArtistManageModal({ artist, open, onClose, onChanged }) {
  const [tab, setTab] = useState('edit')
  const [lookupSource, setLookupSource] = useState('either')
  const [name, setName] = useState(artist?.name || '')
  const [bio, setBio] = useState(artist?.bio || '')
  const [mergeTarget, setMergeTarget] = useState('')
  const [mergeSearch, setMergeSearch] = useState('')
  const [mergeOptions, setMergeOptions] = useState([])
  const [mergeLoading, setMergeLoading] = useState(false)
  // The Merge tab fades in once its first list is in, not through "No
  // matching artists found" first.
  const [mergeFetched, setMergeFetched] = useState(false)
  const [lookupQuery, setLookupQuery] = useState('')
  const [lookupResults, setLookupResults] = useState([])
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [autoMatching, setAutoMatching] = useState(false)
  const [saving, setSaving] = useState(false)
  // What was picked in Lookup this time (shown as "Using"), and the bio opened in full.
  const [pickedImage, setPickedImage] = useState(null)
  const [pickedBio, setPickedBio] = useState(null)
  const [openBio, setOpenBio] = useState(null)
  const fileRef = useRef()
  // Lookup searches by itself the first time it opens for an artist.
  const lookedUp = useRef(null)
  const runLookupRef = useRef(null)
  const deferredMergeSearch = useDeferredValue(mergeSearch)

  useEffect(() => {
    setTab('edit')
    setName(artist?.name || '')
    setBio(artist?.bio || '')
    setMergeTarget('')
    setMergeSearch('')
    setMergeOptions([])
    setMergeFetched(false)
    setLookupQuery(artist?.name || '')
    setLookupSource(peekSettings()?.artist_metadata_source || 'either')
    setLookupResults([])
    setLookupError('')
    setPickedImage(null)
    setPickedBio(null)
    setOpenBio(null)
    lookedUp.current = null
  }, [artist?.id, open])

  useEffect(() => {
    if (!open || tab !== 'lookup' || !artist?.id || lookedUp.current === artist.id) return
    lookedUp.current = artist.id
    runLookupRef.current?.()
  }, [artist?.id, open, tab])

  useEffect(() => {
    if (!open || tab !== 'merge' || !artist) return
    let cancelled = false
    setMergeLoading(true)
    api.getArtistsPage({ search: deferredMergeSearch, limit: 25, offset: 0 }).then((result) => {
      if (cancelled) return
      const items = Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : []
      setMergeOptions(items.filter(option => option.id !== artist.id))
      setMergeLoading(false)
      setMergeFetched(true)
    }).catch(() => {
      if (cancelled) return
      setMergeOptions([])
      setMergeLoading(false)
      setMergeFetched(true)
    })
    return () => {
      cancelled = true
    }
  }, [artist, deferredMergeSearch, open, tab])

  if (!artist) return null

  const pickImage = async () => {
    if (api.isElectron) {
      const fp = await api.openFile()
      if (!fp) return
      const img = new Image()
      img.src = `file://${fp}`
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = img.width; c.height = img.height
        c.getContext('2d').drawImage(img, 0, 0)
        const data = c.toDataURL('image/jpeg', 0.85)
        api.artistSetImage(artist.id, data).then(() => onChanged?.())
      }
    } else {
      fileRef.current?.click()
    }
  }

  const onFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      await api.artistSetImage(artist.id, ev.target.result)
      onChanged?.()
    }
    reader.readAsDataURL(file)
  }

  const saveEdit = async () => {
    setSaving(true)
    if (name.trim() && name.trim() !== artist.name) await api.artistRename(artist.id, name.trim())
    await api.artistUpdateBio(artist.id, bio)
    setSaving(false)
    onChanged?.()
    onClose?.()
  }

  const runLookup = async (source = lookupSource) => {
    const query = lookupQuery.trim()
    if (!query) return
    setLookupLoading(true)
    setLookupError('')
    try {
      const results = await api.artistSearchMetadata(query, { source })
      const items = Array.isArray(results) ? results : []
      setLookupResults(items)
      if (!items.length) setLookupError('No matches found.')
    } catch {
      setLookupResults([])
      setLookupError('Lookup failed.')
    }
    setLookupLoading(false)
  }

  runLookupRef.current = runLookup

  const applyLookup = async (selection, mode) => {
    setSaving(true)
    await api.artistApplyMetadataSelection(artist.id, selection, mode)
    setSaving(false)
    if (mode === 'image') setPickedImage(resultKey(selection))
    if (mode === 'bio') setPickedBio(resultKey(selection))
    onChanged?.()
  }

  const photoResults = lookupResults.filter(result => result.imageUrl).sort(byRank(PHOTO_RANK))
  // A MusicBrainz tag line ("Group • Duluth • slowcore") after the real bios.
  const bioResults = lookupResults.filter(result => result.bio).sort(byRank(BIO_RANK, result => (result.shortBio ? 5 : 0)))

  const useLocalFallback = async () => {
    setSaving(true)
    await api.artistClearImageOverride(artist.id)
    setSaving(false)
    onChanged?.()
  }

  const tryAutoMatch = async () => {
    setAutoMatching(true)
    setLookupError('')
    try {
      // Replaces what was fetched before (a bio or picture set by hand is kept).
      await api.artistRefreshMetadata(artist.id, { force: true, overwrite: true, source: lookupSource })
      onChanged?.()
    } catch {
      setLookupError('Automatic match failed.')
    }
    setAutoMatching(false)
  }

  const doMerge = async () => {
    if (!mergeTarget || mergeTarget === artist.id) return
    setSaving(true)
    await api.artistMerge(artist.id, mergeTarget)
    setSaving(false)
    onChanged?.()
    onClose?.()
  }

  const doDelete = async () => {
    if (!confirm(`Delete artist "${artist.name}"? This does NOT delete tracks, just the artist entry.`)) return
    await api.artistDelete(artist.id)
    onChanged?.()
    onClose?.()
  }

  const artSrc = artist.image_path
    ? (api.isElectron ? `file://${artist.image_path}` : null)
    : null

  return (
    <Modal open={open} onClose={onClose} title={`Manage: ${artist.name}`} width="max-w-lg">
      {}
      <div className="flex gap-1 mb-5 p-0.5 bg-card rounded-lg border border-border">
        {[['edit', 'Edit'], ['lookup', 'Lookup'], ['merge', 'Merge'], ['danger', 'Danger Zone']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex-1 py-1.5 text-xs font-display uppercase tracking-wider rounded transition-colors ${tab === id ? (id === 'danger' ? 'bg-red-500/20 text-red-400' : 'bg-accent text-base') : 'text-muted hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Switching tab: the new one fades in, and the modal glides to its height. */}
      <AutoHeight>
      <SectionSwap id={tab} gated={tab === 'merge'}>
      {tab === 'merge' && <ReadyWhen ready={mergeFetched} />}
      {tab === 'edit' && (
        <div className="space-y-4">
          {}
          <div className="flex items-center gap-4">
            <button onClick={pickImage} className="relative group">
              <div className="w-16 h-16 rounded-full bg-elevated border border-border overflow-hidden flex items-center justify-center">
                {artSrc ? <img src={artSrc} className="w-full h-full object-cover" /> : <span className="text-muted text-2xl">{artist.name[0]}</span>}
              </div>
              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={16} className="text-white" />
              </div>
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} className="hidden" />
            <div className="space-y-2">
              <p className="text-xs text-muted">Click to change artist image</p>
              <button onClick={useLocalFallback} disabled={saving} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-white transition-colors disabled:opacity-40">
                <Undo2 size={12} /> Use local track artwork fallback
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors" />
          </div>
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Bio</label>
            <textarea value={bio} onChange={e => setBio(e.target.value)} rows={4} placeholder="Artist biography..." className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Cancel</button>
            <button onClick={saveEdit} disabled={saving} className="flex-1 py-2.5 bg-accent text-base rounded-xl text-sm font-medium hover:bg-accent-dim transition-colors disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {tab === 'lookup' && (
        <div className="space-y-4">
          <p className="text-xs text-muted leading-relaxed">Pick a photo and a bio separately, from any source. Artists who share a name are listed apart: the line under each name says who it is. What you pick is kept as your choice.</p>
          <div className="flex gap-1 p-0.5 bg-card rounded-lg border border-border">
            {ARTIST_SOURCES.map(([id, label]) => (
              <button
                key={id}
                onClick={() => { setLookupSource(id); runLookup(id) }}
                className={`flex-1 min-w-0 px-1 py-1.5 !text-[10px] font-display uppercase tracking-wide rounded transition-colors ${lookupSource === id ? 'bg-accent text-base' : 'text-muted hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={tryAutoMatch} disabled={autoMatching || saving} className="w-full py-2.5 rounded-xl border border-border text-sm text-muted hover:text-white hover:border-accent/40 transition-colors disabled:opacity-40">
            {autoMatching ? 'Trying to match...' : 'Try auto match'}
          </button>
          <div className="flex gap-2">
            <input
              value={lookupQuery}
              onChange={e => setLookupQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runLookup() }}
              placeholder="Search artist name..."
              className="flex-1 bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors"
            />
            <button onClick={() => runLookup()} disabled={lookupLoading || !lookupQuery.trim()} className="px-4 py-2.5 rounded-xl bg-accent text-base text-sm font-medium hover:bg-accent-dim transition-colors disabled:opacity-40">
              <Search size={14} className="inline mr-1.5" />Search
            </button>
          </div>
          {lookupError && <p className="text-xs text-amber-300">{lookupError}</p>}
          <div className="space-y-5 max-h-[26rem] overflow-y-auto pr-1">
            {lookupLoading && <p className="text-xs text-muted">Searching...</p>}
            {!lookupLoading && !lookupResults.length && !lookupError && (
              <p className="text-xs text-muted">Search for a better artist match.</p>
            )}
            {!lookupLoading && photoResults.length > 0 && (
              <section>
                <h3 className="text-xs font-display text-muted uppercase tracking-widest mb-2">Photos</h3>
                <div className="grid grid-cols-3 gap-2">
                  {photoResults.map(result => {
                    const picked = pickedImage === resultKey(result)
                    return (
                      <button
                        key={resultKey(result)}
                        onClick={() => applyLookup(result, 'image')}
                        disabled={saving}
                        title={[result.title, stripHtml(result.snippet), sourceLabel(result.source)].filter(Boolean).join(' · ')}
                        className={`group text-left rounded-xl border p-1.5 transition-colors disabled:opacity-60 ${picked ? 'border-accent bg-accent/10' : 'border-border bg-card hover:border-accent/40'}`}
                      >
                        <div className="relative aspect-square rounded-lg overflow-hidden bg-elevated">
                          <img src={result.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                          {picked && <span className="absolute top-1 right-1 rounded-full bg-accent text-base p-0.5"><Check size={12} /></span>}
                        </div>
                        <p className="mt-1.5 text-[11px] font-medium text-white truncate">{result.title}</p>
                        <p className="text-[10px] text-muted truncate">{sourceLabel(result.source)}{result.snippet ? ` · ${stripHtml(result.snippet)}` : ''}</p>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}
            {!lookupLoading && bioResults.length > 0 && (
              <section>
                <h3 className="text-xs font-display text-muted uppercase tracking-widest mb-2">Bios</h3>
                <div className="space-y-2">
                  {bioResults.map(result => {
                    const key = resultKey(result)
                    const picked = pickedBio === key
                    const expanded = openBio === key
                    return (
                      <div key={key} className={`rounded-xl border p-3 space-y-2 ${picked ? 'border-accent bg-accent/10' : 'border-border bg-card'}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{result.title}</p>
                          <span className="px-1.5 py-0.5 rounded bg-elevated border border-border text-[10px] uppercase tracking-wider text-muted flex-shrink-0">{sourceLabel(result.source)}</span>
                        </div>
                        {result.snippet && <p className="text-[11px] text-accent/80 truncate">{stripHtml(result.snippet)}</p>}
                        <p className={`text-xs text-muted leading-relaxed whitespace-pre-line ${expanded ? '' : 'line-clamp-3'}`}>{result.bio}</p>
                        <div className="flex items-center gap-3">
                          <button onClick={() => applyLookup(result, 'bio')} disabled={saving || picked}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-60 ${picked ? 'bg-accent/20 text-accent' : 'bg-accent text-base hover:bg-accent-dim'}`}>
                            {picked ? <><Check size={12} /> Using this bio</> : 'Use this bio'}
                          </button>
                          {result.bio.length > 180 && (
                            <button onClick={() => setOpenBio(expanded ? null : key)} className="text-xs text-muted hover:text-white transition-colors">
                              {expanded ? 'Less' : 'Read more'}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {tab === 'merge' && (
        <div className="space-y-4">
          <p className="text-xs text-muted leading-relaxed">Merge <strong className="text-white">{artist.name}</strong> into another artist. All tracks will be reassigned. This cannot be undone.</p>
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Search artists</label>
            <input
              value={mergeSearch}
              onChange={e => setMergeSearch(e.target.value)}
              placeholder="Search by artist name..."
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors mb-3"
            />
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Merge into</label>
            <select value={mergeTarget} onChange={e => setMergeTarget(e.target.value)} className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors">
              <option value="">Select target artist…</option>
              {mergeOptions.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({plural(a.track_count, 'track')})</option>
              ))}
            </select>
            <p className="text-xs text-muted mt-2">
              {mergeLoading && !mergeOptions.length ? 'Loading artists...' : mergeOptions.length ? `Showing ${mergeOptions.length} matching artists` : 'No matching artists found'}
            </p>
          </div>
          <button onClick={doMerge} disabled={!mergeTarget || saving} className="w-full py-2.5 bg-orange-500/20 border border-orange-500/40 text-orange-300 rounded-xl text-sm font-medium hover:bg-orange-500/30 transition-colors disabled:opacity-40">
            <Merge size={14} className="inline mr-2" />Merge Artists
          </button>
        </div>
      )}

      {tab === 'danger' && (
        <div className="space-y-4">
          <p className="text-xs text-muted leading-relaxed">Delete the artist entry for <strong className="text-white">{artist.name}</strong>. Tracks will remain in your library but this artist profile will be removed.</p>
          <button onClick={doDelete} className="w-full py-2.5 bg-red-500/15 border border-red-500/30 text-red-400 rounded-xl text-sm font-medium hover:bg-red-500/25 transition-colors flex items-center justify-center gap-2">
            <Trash2 size={14} /> Delete Artist Profile
          </button>
        </div>
      )}
      </SectionSwap>
      </AutoHeight>
    </Modal>
  )
}
