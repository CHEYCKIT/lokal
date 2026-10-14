// Home → Releases: the newest releases by the artists in your library, newest
// first, as a list of albums with their details. Checked when you refresh
// (every artist's catalogue); the last check is kept for the next visit.

import { useTranslation } from '../i18n'
import React, { useState } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { CalendarDays, Disc3, Loader2, MoreHorizontal, Play, RefreshCw, Users, X } from 'lucide-react'
import DiscoveryImage from './DiscoveryImage'
import FollowedArtistsModal from './FollowedArtistsModal'
import { checkReleases, isNewRelease, loadArtistReleases, savedReleases } from '../newReleases'
import { api } from '../api'
import { discoveryArtistKey, useDiscoveryArtists } from '../discoveryArtists'

const TYPE_LABEL = { album: 'Album', single: 'Single', ep: 'EP' }

export function ago(time, t = value => value) {
  if (!time) return ''
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return t('Just now')
  if (minutes < 60) return t('{count} min ago', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('{count} h ago', { count: hours })
  return new Date(time).toLocaleDateString()
}

function dateLabel(release) {
  const date = String(release.release_date || release.releaseDate || '')
  // A plain date ("2026-09-30") is that calendar day everywhere: read as UTC
  // and shown in UTC, it can't slip to the day before west of Greenwich.
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
  if (date.length > 4 && Number.isFinite(Date.parse(date))) return new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  return String(release.year || date.slice(0, 4) || '')
}

function ReleaseRow({ release, index, onPlay, onOpen, onMenu, onArtist }) {
  const { t } = useTranslation()
  const type = t(TYPE_LABEL[release.release_type] || 'Release')
  return (
    <div role="listitem" onContextMenu={event => onMenu?.(event, release)}
      className="group grid grid-cols-[2rem_4.5rem_minmax(0,1fr)_auto] items-center gap-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-elevated">
      <span className="text-right text-xs tabular-nums text-muted">{index + 1}</span>
      <button type="button" onClick={() => onOpen(release)} aria-label={t('Open {title}', { title: release.title })} className="relative h-[4.5rem] w-[4.5rem] overflow-hidden rounded-lg bg-card shadow-md">
        <DiscoveryImage item={release} type="album" src={release.artwork_url} className="h-full w-full object-cover" fallback={<div className="flex h-full items-center justify-center text-muted"><Disc3 size={24} /></div>} />
      </button>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => onOpen(release)} className="truncate text-left text-sm font-semibold text-white hover:underline">{release.title}</button>
          {isNewRelease(release) && <span title={t("Out less than a week ago")} className="flex-shrink-0 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">{t("New")}</span>}
        </div>
        <button type="button" onClick={() => onArtist(release)} className="block max-w-full truncate text-left text-xs text-white/75 hover:text-white hover:underline">{release.artist}</button>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
          <span className="rounded border border-border px-1.5 py-px text-[10px] uppercase tracking-wider">{type}</span>
          <CalendarDays size={11} />{dateLabel(release)}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onPlay(release)} title={t('Play {title}', { title: release.title })} aria-label={t('Play {title}', { title: release.title })} className="flex h-9 w-9 items-center justify-center text-white/80 transition hover:scale-110 hover:text-accent"><Play size={20} fill="currentColor" strokeWidth={0} /></button>
        <button type="button" onClick={event => onMenu?.(event, release)} title={t("More")} aria-label={t('More for {title}', { title: release.title })} className="rounded-full p-2 text-muted opacity-0 transition-opacity hover:text-white group-hover:opacity-100 focus:opacity-100"><MoreHorizontal size={16} /></button>
      </div>
    </div>
  )
}

// The check lives outside the page: leaving Home (or the tab) doesn't stop
// it or lose what it found, and coming back shows its progress.
export const useReleaseCheck = create((set, get) => ({
  saved: savedReleases(),
  checking: null, // { done, total, added }
  run: 0,
  start: async artists => {
    if (get().checking) return
    const id = get().run + 1
    const isCurrent = () => get().run === id
    set({ run: id, checking: { done: 0, total: artists.length, added: 0 } })
    try {
      const result = await checkReleases(artists, name => loadArtistReleases(name, api), {
        isCurrent,
        onProgress: ({ done, total, items, added }) => { if (isCurrent()) set(state => ({ checking: { done, total, added }, saved: { ...state.saved, items } })) },
      })
      if (isCurrent()) set({ saved: result })
    } finally { if (isCurrent()) set({ checking: null }) }
  },
  stop: () => set(state => ({ run: state.run + 1, checking: null, saved: savedReleases() })),
}))

/** `artists`: the followed ones (checked); `libraryArtists`: the checklist's. */
export default function ReleasesPanel({ artists, libraryArtists = [], onPlay, onOpen, onMenu, onArtist }) {
  const { t } = useTranslation()
  const { saved, checking, start, stop } = useReleaseCheck(useShallow(state => ({ saved: state.saved, checking: state.checking, start: state.start, stop: state.stop })))
  const refresh = () => start(artists)
  const [choosing, setChoosing] = useState(false)

  // Unfollowing an artist takes their releases out at once, without a new check.
  const followed = useDiscoveryArtists(state => state.followed)
  const items = (saved?.items || []).filter(release => followed.has(discoveryArtistKey(release.seedArtist || release.artist)))
  const newCount = items.filter(release => isNewRelease(release)).length
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-display uppercase tracking-[0.25em] text-accent">{t("Releases")}</p>
          <h2 className="mt-1 text-xl font-medium text-white">{t("New from your artists")}</h2>
          <p className="mt-1 text-xs text-muted">
            {checking ? t('Checking releases: {done}/{total} artists{added}', { done: checking.done, total: checking.total, added: checking.added ? ` · ${t('{count} added', { count: checking.added })}` : '' })
              : saved?.checkedAt ? t('Latest {count} releases by {artists} followed artists · checked {age}{details}', { count: items.length, artists: artists.length, age: ago(saved.checkedAt, t), details: [saved.added ? t('{count} added', { count: saved.added }) : '', newCount ? t('{count} new', { count: newCount }) : '', saved.failures ? t('{count} artists could not be checked', { count: saved.failures }) : ''].filter(Boolean).map(value => ` · ${value}`).join('') })
              : t('The latest {count} releases by the artists you follow, newest first.', { count: 100 })}
          </p>
        </div>
        <div className="flex items-center gap-2">
        <button type="button" onClick={() => setChoosing(true)} title={t("Choose the artists whose releases show here")}
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs text-text hover:border-accent/40"><Users size={13} />{t('Followed artists')}<span className="tabular-nums text-muted">{artists.length}</span></button>
        {checking
          ? <button type="button" onClick={stop} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs text-text hover:border-accent/40"><Loader2 size={13} className="animate-spin text-accent" />{t('Stop')}<X size={12} className="text-muted" /></button>
          : <button type="button" onClick={refresh} disabled={!artists.length} className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-medium text-[rgb(var(--bg-rgb))] disabled:opacity-40"><RefreshCw size={13} />{saved?.checkedAt ? t('Refresh') : t('Check for releases')}</button>}
        </div>
      </div>
      <FollowedArtistsModal open={choosing} onClose={() => setChoosing(false)} libraryArtists={libraryArtists} />
      {checking && <div className="h-1 overflow-hidden rounded-full bg-elevated"><div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${checking.total ? (checking.done / checking.total) * 100 : 0}%` }} /></div>}
      {items.length ? (
        <div role="list" aria-label={t("New releases")} className="space-y-0.5">
          {items.map((release, index) => <ReleaseRow key={`${release.artist}\u0000${release.title}`} release={release} index={index} onPlay={onPlay} onOpen={onOpen} onMenu={onMenu} onArtist={onArtist} />)}
        </div>
      ) : !checking && (
        <div className="rounded-xl border border-border bg-elevated px-4 py-12 text-center">
          <CalendarDays size={30} className="mx-auto mb-3 text-muted/60" />
          <p className="text-sm text-text">{artists.length ? (saved?.checkedAt ? t('No dated releases were found.') : t('See what your artists released lately.')) : t('Follow artists to see their new releases here.')}</p>
          {artists.length > 0
            ? <p className="mt-1 text-xs text-muted">{t("Refresh checks each followed artist’s catalogue on YouTube Music.")}</p>
            : <button type="button" onClick={() => setChoosing(true)} className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-medium text-[rgb(var(--bg-rgb))]"><Users size={13} />{t("Choose artists to follow")}</button>}
        </div>
      )}
    </section>
  )
}
