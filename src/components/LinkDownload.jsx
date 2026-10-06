// A link pasted into the search box: what it is (one song, or a playlist /
// album / channel) and a button to download it into the library, then its
// progress right there. Enter in the search box starts the first choice.
// A playlist can also be saved as one of your playlists without downloading
// (Import playlist, from a link, with this link filled in).

import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Disc3, Download, Library, Link2, ListMusic, ListPlus } from 'lucide-react'
import { useDownloads, startDownloadSync } from '../store/downloads'
import { useSearchStore } from '../store/search'
import { inferTitleFromUrl, linkKind, splitLink } from '../downloadLinks'
import { DownloadRow } from './DownloadManager'
import DownloadNotices from './DownloadNotices'

function sourceOf(link) {
  try {
    const host = new URL(link).hostname.replace(/^(?:www|m)\./, '')
    if (host === 'music.youtube.com') return { label: 'YouTube Music', youtube: true }
    if (host === 'youtu.be' || /(^|\.)youtube\.com$/.test(host)) return { label: 'YouTube', youtube: true }
    if (/(^|\.)soundcloud\.com$/.test(host)) return { label: 'SoundCloud' }
    if (/(^|\.)bandcamp\.com$/.test(host)) return { label: 'Bandcamp' }
    return { label: host }
  } catch {
    return { label: 'Link' }
  }
}

/** The ways to download `link`: the song, everything, or (a song in a playlist) either. */
function choicesFor(link) {
  const kind = linkKind(link)
  if (kind === 'both') {
    const { song, list } = splitLink(link)
    return [
      { id: 'song', kind: 'single', url: song, label: 'This song', icon: Disc3, title: inferTitleFromUrl(song, 'Song') },
      { id: 'list', kind: 'playlist', url: list, label: 'Whole playlist', icon: ListMusic, title: inferTitleFromUrl(list, 'Playlist / Album') },
    ]
  }
  if (kind === 'single') return [{ id: 'song', kind: 'single', url: link, label: 'Download song', icon: Download, title: inferTitleFromUrl(link, 'Song') }]
  return [{ id: 'all', kind: 'playlist', url: link, label: 'Download all', icon: Download, title: inferTitleFromUrl(link, 'Playlist / Album') }]
}

export default function LinkDownload({ link }) {
  const source = sourceOf(link)
  const kind = linkKind(link)
  const choices = choicesFor(link)
  const jobs = useDownloads(s => s.jobs)
  const enqueue = useDownloads(s => s.enqueue)
  const [pending, setPending] = useState(null) // a choice's id, while it's being queued
  const [error, setError] = useState('')
  useEffect(() => { startDownloadSync() }, [])
  useEffect(() => { setError(''); setPending(null) }, [link])

  const jobFor = (choice) => jobs.find(job => !job.removed && job.url === choice.url && (job.kind || 'single') === choice.kind) || null

  const start = async (choice) => {
    if (pending || jobFor(choice)) return
    setError('')
    setPending(choice.id)
    const result = await enqueue(choice.kind, choice.url, { title: choice.title, from: 'Link' }).catch(e => ({ error: e.message }))
    setPending(null)
    if (result?.error) setError(result.error)
  }

  // Enter in the search box: the first choice (the song, for a song in a
  // playlist). Pressed on this link, even before this was shown (the page
  // still appearing), it's taken once.
  const submitSeq = useSearchStore(s => s.submitSeq)
  const takeSubmit = useSearchStore(s => s.takeSubmit)
  useEffect(() => {
    if (takeSubmit(link)) start(choices[0])
  }, [submitSeq, link]) // eslint-disable-line react-hooks/exhaustive-deps

  const listUrl = kind === 'both' ? splitLink(link).list : kind === 'single' ? null : link
  const saveAsPlaylist = () => window.dispatchEvent(new CustomEvent('lokal:playlist-import', { detail: { source: 'link', url: listUrl } }))

  const started = choices.map(jobFor).filter(Boolean)
  const what = kind === 'single' ? 'Song' : kind === 'both' ? 'Song from a playlist' : 'Playlist, album or channel'

  return (
    <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-3" aria-label="Download a link">
      <h2 className="text-xs font-display text-muted uppercase tracking-widest flex items-center gap-2">
        <Link2 size={12} /> Link
      </h2>
      <div className="rounded-2xl border border-border bg-elevated/60 p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-card text-accent">
            {kind === 'single' ? <Disc3 size={20} /> : <Library size={20} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text">{choices[0].title}</p>
            <p className="mt-0.5 truncate text-xs text-muted">
              <span className="text-accent/90">{what}</span> · {source.label}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-subtle">{link}</p>
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
            {choices.map((choice, i) => {
              const job = jobFor(choice)
              const Icon = choice.icon
              return (
                <button
                  key={choice.id}
                  onClick={() => start(choice)}
                  disabled={!!job || !!pending}
                  title={i === 0 ? 'Enter in the search box does this too' : undefined}
                  className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors disabled:cursor-default ${i === 0 ? 'bg-accent text-[rgb(var(--bg-rgb))] hover:bg-accent/85 disabled:bg-accent/30' : 'border border-border text-text hover:border-accent/50 disabled:opacity-40'}`}
                >
                  {pending === choice.id ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Icon size={13} />}
                  {choice.label}
                </button>
              )
            })}
            {listUrl && (
              <button
                onClick={saveAsPlaylist}
                title="Add it to your playlists without downloading; songs you don't have stream"
                className="flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-xs font-semibold text-text transition-colors hover:border-accent/50"
              >
                <ListPlus size={13} />
                Save as playlist
              </button>
            )}
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        {started.length > 0 && (
          <div className="mt-3 space-y-2">
            {started.map(job => <DownloadRow key={job.id} job={job} detailed />)}
          </div>
        )}
        {!started.length && (
          <p className="mt-3 text-[11px] text-muted">
            Saved to your music folder and added to the library, with lyrics and a square cover. The real {kind === 'single' ? 'title' : 'name'} is filled in from {source.label} once it starts.
          </p>
        )}
      </div>
      <DownloadNotices youtube={!!source.youtube} />
    </motion.section>
  )
}
