import React from 'react'
import { useTranslation } from '../i18n'
import { discoveryArtistKey, useDiscoveryArtists } from '../discoveryArtists'
import FollowArtistButton from './FollowArtistButton'

/** The artists you unfollowed, kept out of Discovery: follow them again from here. */
export default function UnfollowedArtists({ artists = [] }) {
  const { t } = useTranslation()
  const hidden = useDiscoveryArtists(s => s.hidden)
  if (!hidden.size) return null
  const names = new Map(artists.map(artist => [discoveryArtistKey(artist.name), artist.name]))
  return <details className="rounded-xl border border-border bg-elevated p-4">
    <summary className="cursor-pointer text-sm text-muted hover:text-white">{t('Unfollowed artists')} ({hidden.size})</summary>
    <div className="mt-3 space-y-2">{[...hidden].sort().map(key => <div key={key} className="flex items-center justify-between gap-3">
      <span className="truncate text-sm text-white">{names.get(key) || key}</span>
      <FollowArtistButton name={names.get(key) || key} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-50" />
    </div>)}</div>
  </details>
}
