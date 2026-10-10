import React, { useEffect, useMemo, useState } from 'react'
import { Bell, EyeOff } from 'lucide-react'
import { api } from '../api'
import { loadReleaseFeed, releaseKey, RELEASE_ROLE_MODES, useReleaseFeed, useReleaseFeedPrefs, visibleReleases } from '../releaseFeed'

const dateLabel = date => {
  const time = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(time) ? new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : date
}

function ReleaseCard({ release, onHide }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className="group flex gap-4 p-3 rounded-xl bg-card border border-border">
      <div className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-elevated flex items-center justify-center text-subtle">
        {!broken ? <img src={release.artworkUrl} alt="" loading="lazy" onError={() => setBroken(true)} className="w-full h-full object-cover" /> : <span aria-hidden>♪</span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white truncate">{release.title}</p>
        <p className="text-xs text-muted truncate">{release.artists}</p>
        <p className="text-[11px] text-subtle mt-1 capitalize">
          {release.type} · {dateLabel(release.date)}{release.role === 'supporting' ? ' · Featured' : ''}
        </p>
      </div>
      <button
        onClick={() => onHide(release.artistName)}
        title={`Hide releases from ${release.artistName}`}
        aria-label={`Hide releases from ${release.artistName}`}
        className="self-start p-1.5 rounded-full text-subtle opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-white transition-opacity"
      >
        <EyeOff size={14} />
      </button>
    </div>
  )
}

export default function NewReleases() {
  const { loading, done, total, artists, error } = useReleaseFeed()
  const { mode, hidden, setMode, hideArtist, showArtist } = useReleaseFeedPrefs()
  const [libraryNames, setLibraryNames] = useState([])

  useEffect(() => {
    let active = true
    api.getArtists().then(list => {
      if (!active) return
      const names = (list || []).map(artist => artist.name).filter(Boolean)
      setLibraryNames(names)
      loadReleaseFeed(names)
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const releases = useMemo(() => visibleReleases(artists, { mode, hidden }), [artists, mode, hidden])
  const hiddenNames = libraryNames.filter(name => hidden.includes(releaseKey(name)))

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Bell size={18} className="text-accent" />
          <div>
            <h2 className="text-lg font-display text-white">New Releases</h2>
            <p className="text-xs text-muted">
              {loading ? `Checking ${done} of ${total} artists…` : 'Singles, EPs and albums from the artists in your library, from the last four months'}
            </p>
          </div>
        </div>
        <div className="flex gap-1 p-0.5 bg-elevated rounded-lg border border-border w-fit">
          {RELEASE_ROLE_MODES.map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)} aria-pressed={mode === id}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${mode === id ? 'bg-card text-white' : 'text-muted hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {releases.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {releases.map(release => <ReleaseCard key={`${release.id}-${release.artistName}`} release={release} onHide={hideArtist} />)}
        </div>
      ) : !loading && !error && (
        <p className="py-10 text-center text-sm text-muted">No new releases in the last four months{mode === 'main' ? ' from your artists' : ' for this view'}.</p>
      )}

      {hiddenNames.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-widest text-muted">Hidden artists</h3>
          <div className="flex flex-wrap gap-2">
            {hiddenNames.map(name => (
              <button key={name} onClick={() => showArtist(name)} className="px-3 py-1 text-xs rounded-full border border-border text-muted hover:text-white">
                {name} · Show
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
