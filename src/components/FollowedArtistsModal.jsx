// Home → Releases → Followed artists: every artist in the library (and every
// one followed from elsewhere) with a checkbox, a search, follow / unfollow
// all of what's shown, and importing the artists you follow on Spotify or
// have in your Apple Music library.

import { useTranslation } from '../i18n'
import React, { useMemo, useState } from 'react'
import { Link2, Loader2, Search } from 'lucide-react'
import Modal from './Modal'
import { showToast } from './Toaster'
import { api } from '../api'
import { plural } from '../plural'
import { discoveryArtistKey, setArtistsFollowed, useDiscoveryArtists } from '../discoveryArtists'

const SERVICES = {
  spotify: {
    label: 'Spotify',
    setting: 'spotify_sp_dc',
    what: 'the artists you follow',
    help: 'Spotify needs your sign-in cookie (the same one Spotify Canvas uses): open open.spotify.com in your browser and sign in, press F12, go to Application (Storage in Firefox) › Cookies › open.spotify.com, and copy the value of sp_dc.',
    placeholder: 'sp_dc value',
  },
  appleMusic: {
    label: 'Apple Music',
    setting: 'apple_music_user_token',
    what: 'the artists in your library',
    help: 'Apple Music needs your sign-in token: open music.apple.com in your browser and sign in, press F12, go to Application (Storage in Firefox) › Cookies › music.apple.com, and copy the value of media-user-token.',
    placeholder: 'media-user-token value',
  },
}
const needsSignIn = message => /cookie|token|sp_dc|accept/i.test(String(message || ''))

function LinkService({ id, onImported }) {
  const { t } = useTranslation()
  const service = SERVICES[id]
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const importFollows = async () => {
    setBusy(true); setError('')
    try {
      if (value.trim()) {
        const saved = await api.saveSettings({ [service.setting]: value.trim() })
        if (saved?.error) throw new Error(saved.error)
      }
      const result = await api.linkedFollowedArtists(id)
      if (result?.error) {
        if (needsSignIn(result.error)) setAsking(true)
        throw new Error(result.error)
      }
      setAsking(false); setValue('')
      await onImported(service.label, result.names || [])
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card/40 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted"><span className="text-white">{service.label}</span> · follow {service.what} there too</p>
        <button type="button" onClick={importFollows} disabled={busy || (asking && !value.trim())}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] text-text hover:border-accent/40 disabled:opacity-40">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}{asking ? 'Save and import' : 'Import'}
        </button>
      </div>
      {asking && (
        <div className="space-y-1.5">
          <p className="text-[11px] leading-relaxed text-muted">{service.help} It stays on this computer and is only sent to {service.label}.</p>
          <input type="password" value={value} onChange={event => setValue(event.target.value)} placeholder={service.placeholder} spellCheck={false} autoComplete="off"
            className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-text outline-none focus:border-accent/50" />
        </div>
      )}
      {error && <p className="text-[11px] text-red">{error}</p>}
    </div>
  )
}

export default function FollowedArtistsModal({ open, onClose, libraryArtists = [] }) {
  const { t } = useTranslation()
  const followed = useDiscoveryArtists(s => s.followed)
  const [query, setQuery] = useState('')
  // Every library artist, and anyone followed who isn't in the library.
  const artists = useMemo(() => {
    const byKey = new Map()
    for (const artist of libraryArtists) {
      const key = discoveryArtistKey(artist?.name)
      if (key && !byKey.has(key)) byKey.set(key, { key, name: artist.name, library: true })
    }
    for (const [key, name] of followed) if (!byKey.has(key)) byKey.set(key, { key, name, library: false })
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [libraryArtists, followed])
  const needle = query.trim().toLowerCase()
  const shown = needle ? artists.filter(artist => artist.name.toLowerCase().includes(needle)) : artists
  const followedCount = artists.filter(artist => followed.has(artist.key)).length
  const allShownFollowed = shown.length > 0 && shown.every(artist => followed.has(artist.key))

  const save = (names, follow) => setArtistsFollowed(names, follow).catch(error => showToast(error.message))
  const imported = async (label, names) => {
    const fresh = names.filter(name => !followed.has(discoveryArtistKey(name)))
    await setArtistsFollowed(names, true)
    showToast(names.length ? `${plural(names.length, 'artist')} from ${label}: ${fresh.length ? `now following ${fresh.length} more` : 'already following them all'}.` : `No artists found on ${label}.`)
  }

  return (
    <Modal open={open} onClose={onClose} title={t("Followed artists")} width="max-w-lg">
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-muted">{t("Releases shows the new releases of the artists you follow. Artists of songs you add to your library aren't followed until you tick them here (or press Follow on their page).")}</p>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 focus-within:border-accent/50">
          <Search size={13} className="flex-shrink-0 text-muted" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Search artists")} aria-label={t("Search artists")}
            className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-muted" />
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          <span className="min-w-0 flex-1">{plural(followedCount, 'artist')} followed of {artists.length}</span>
          {shown.length > 0 && (
            <button type="button" onClick={() => save(shown.map(artist => artist.name), !allShownFollowed)} className="flex-shrink-0 hover:text-white">
              {allShownFollowed ? (needle ? 'Unfollow these' : 'Unfollow all') : (needle ? 'Follow these' : 'Follow all')}
            </button>
          )}
        </div>
        <div role="list" aria-label={t("Artists")} className="max-h-[45vh] space-y-0.5 overflow-y-auto pr-1">
          {!shown.length && <p className="py-6 text-center text-xs text-muted">{artists.length ? 'No artist matches.' : 'No artists yet. Add music to your library, or import the ones you follow below.'}</p>}
          {shown.map(artist => (
            <label key={artist.key} role="listitem" className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
              <input type="checkbox" checked={followed.has(artist.key)} onChange={event => save([artist.name], event.target.checked)}
                className="h-3.5 w-3.5 flex-shrink-0 accent-[rgb(var(--accent-rgb))]" />
              <span className="min-w-0 flex-1 truncate text-sm text-white">{artist.name}</span>
              {!artist.library && <span className="flex-shrink-0 text-[10px] text-muted">{t("Not in library")}</span>}
            </label>
          ))}
        </div>
        {api.isElectron && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-[11px] font-display uppercase tracking-widest text-muted">{t("Import from")}</p>
            {Object.keys(SERVICES).map(id => <LinkService key={id} id={id} onImported={imported} />)}
          </div>
        )}
      </div>
    </Modal>
  )
}
