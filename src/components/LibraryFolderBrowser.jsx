import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ChevronRight, Folder, Music } from 'lucide-react'
import { api } from '../api'
import TrackList from './TrackList'
import FadeImg from './FadeImg'
import { useTranslation } from '../i18n'

export default function LibraryFolderBrowser({ folderPath, onFolderChange, onDataChange, view, playQueue, artSrc }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const requestRef = useRef(0)

  useEffect(() => {
    const refresh = () => setRefreshKey(value => value + 1)
    window.addEventListener('lokal:refresh', refresh)
    return () => window.removeEventListener('lokal:refresh', refresh)
  }, [])

  useEffect(() => {
    let active = true
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    onDataChange?.(null)

    Promise.resolve(api.getLibraryFolders(folderPath)).then(result => {
      if (!active || requestId !== requestRef.current) return
      if (result?.notFound && folderPath) {
        setData(null)
        onDataChange?.(null)
        onFolderChange('')
        return
      }
      setData(result || null)
      onDataChange?.(result || null)
      setError(result?.error || '')
    }).catch(err => {
      if (!active || requestId !== requestRef.current) return
      setError(err?.message || 'Could not load this folder')
      onDataChange?.(null)
    }).finally(() => {
      if (active && requestId === requestRef.current) setLoading(false)
    })

    return () => {
      active = false
      requestRef.current++
    }
  }, [folderPath, refreshKey, onDataChange, onFolderChange])

  const segments = String(data?.relativePath || '').split('/').filter(Boolean)
  const currentFolder = segments.length ? segments[segments.length - 1] : (data?.rootName || 'Music folder')
  const isCurrentPath = !!data && data.relativePath === folderPath
  const displayedError = error || (isCurrentPath ? data?.error : '')

  return (
    <div className="space-y-4">
      {isCurrentPath && data?.available && !data.error && (
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted" aria-label="Library folder path">
          {segments.length > 0 && (
            <button
              type="button"
              onClick={() => onFolderChange(segments.slice(0, -1).join('/'))}
              aria-label="Go to parent folder"
              className="mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-elevated transition-colors hover:text-white"
            >
              <ArrowLeft size={13} />
            </button>
          )}
          <button type="button" onClick={() => onFolderChange('')} className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 transition-colors hover:text-white">
            <Folder size={13} className="flex-shrink-0" />
            <span className="max-w-36 truncate">{data.rootName}</span>
          </button>
          {segments.map((segment, index) => {
            const target = segments.slice(0, index + 1).join('/')
            return (
              <React.Fragment key={target}>
                <ChevronRight size={12} className="flex-shrink-0 opacity-50" />
                <button type="button" onClick={() => onFolderChange(target)} className="max-w-40 truncate rounded-md px-1 py-1 text-white transition-colors hover:text-accent" title={segment}>
                  {segment}
                </button>
              </React.Fragment>
            )
          })}
          <span className="sr-only">{currentFolder}</span>
        </div>
      )}

      {loading && <p className="text-xs text-muted" role="status">{t("Loading folder…")}</p>}

      {displayedError && (
        <div className="rounded-xl border border-border bg-elevated px-5 py-10 text-center text-muted">
          <Folder size={34} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{displayedError}</p>
          {!data?.available && <p className="mt-2 text-xs">Select a music folder above to browse it here.</p>}
        </div>
      )}

      {isCurrentPath && data?.available && !displayedError && (
        <motion.div
          key={data.relativePath || 'library-root'}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
          className="space-y-5"
        >
          {data.folders?.length > 0 && view === 'grid' && (
            <div className="grid grid-cols-2 @sm:grid-cols-3 @md:grid-cols-4 @lg:grid-cols-5 gap-3">
              {data.folders.map(folder => (
                <motion.button
                  key={folder.path}
                  type="button"
                  initial={false}
                  whileHover={{ y: -3 }}
                  onClick={() => onFolderChange(folder.path)}
                  className="group flex min-w-0 flex-col gap-2 text-left"
                >
                  <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-elevated transition-colors group-hover:border-accent/40 group-hover:bg-accent/5">
                    <Folder size={42} strokeWidth={1.5} className="text-muted transition-colors group-hover:text-accent" />
                  </div>
                  <div className="w-full min-w-0 px-1">
                    <p className="truncate text-xs font-medium text-white" title={folder.name}>{folder.name}</p>
                    <p className="text-[11px] text-muted">Folder</p>
                  </div>
                </motion.button>
              ))}
            </div>
          )}

          {data.folders?.length > 0 && view === 'list' && (
            <div className="overflow-hidden rounded-xl border border-border bg-card/40 divide-y divide-border">
              {data.folders.map(folder => (
                <button
                  key={folder.path}
                  type="button"
                  onClick={() => onFolderChange(folder.path)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated/80"
                >
                  <Folder size={17} className="flex-shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-sm text-white">{folder.name}</span>
                  <ChevronRight size={14} className="flex-shrink-0 text-muted" />
                </button>
              ))}
            </div>
          )}

          {data.tracks?.length > 0 && view === 'list' && (
            <TrackList tracks={data.tracks} showQuality reduceMotion />
          )}

          {data.tracks?.length > 0 && view === 'grid' && (
            <div className="grid grid-cols-3 @sm:grid-cols-4 @md:grid-cols-5 gap-3">
              {data.tracks.map((track, index) => {
                const src = artSrc(track)
                return (
                  <motion.button
                    key={track.id}
                    type="button"
                    initial={false}
                    whileHover={{ y: -2 }}
                    onDoubleClick={() => playQueue(data.tracks, index)}
                    className="group flex min-w-0 flex-col gap-2 text-left"
                  >
                    <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-elevated">
                      {src
                        ? <FadeImg src={src} alt={track.title} className="h-full w-full object-cover" />
                        : <Music size={28} className="text-muted" />}
                    </div>
                    <div className="w-full min-w-0">
                      <p className="truncate text-xs font-medium text-white">{track.title}</p>
                      <p className="truncate text-xs text-muted">{track.artist}</p>
                    </div>
                  </motion.button>
                )
              })}
            </div>
          )}

          {!data.folders?.length && !data.tracks?.length && (
            <div className="py-20 text-center text-muted">
              <Folder size={42} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">{t("This folder is empty.")}</p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
