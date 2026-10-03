import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ListPlus, Play, Radio as RadioIcon, RefreshCw } from 'lucide-react'
import TrackList from '../components/TrackList'
import { usePlayerStore, useAppStore } from '../store/player'
import { buildRadio } from '../radioActions'
import { saveAsPlaylist } from '../trackActions'
import { trackArtURL } from '../onlineTracks'
import FadeImg from '../components/FadeImg'
import { showToast } from '../components/Toaster'

export default function Radio() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAppStore()
  const { playQueue } = usePlayerStore()
  const seed = location.state?.seed || location.state?.tracks?.[0]
  const [tracks, setTracks] = useState(() => location.state?.tracks || [])
  const [loading, setLoading] = useState(false)
  const sessionKeyRef = useRef(location.key)

  useEffect(() => {
    sessionKeyRef.current = location.key
    setLoading(false)
    const incomingTracks = Array.isArray(location.state?.tracks) ? location.state.tracks : []
    setTracks(incomingTracks)
    if (incomingTracks.length) playQueue(incomingTracks, 0, { type: 'radio', name: location.state?.name || 'Radio' })
    // The queue should start only when this radio session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      sessionKeyRef.current = null
    }
  }, [location.key])

  const regenerate = async () => {
    if (!seed || loading) return
    const sessionKey = sessionKeyRef.current
    setLoading(true)
    const next = await buildRadio(seed, user?.id)
    if (sessionKey !== sessionKeyRef.current) return
    setLoading(false)
    if (next.length) {
      setTracks(next)
      playQueue(next, 0, { type: 'radio', name: `${seed.title || seed.artist} Radio` })
    } else showToast('Could not find enough related tracks')
  }

  const save = async () => {
    const playlist = await saveAsPlaylist(`${seed?.title || seed?.artist || 'Song'} Radio`, tracks, { userId: user?.id, description: 'Generated radio from Lokal' }).catch(() => null)
    showToast(playlist ? 'Radio saved as a playlist' : 'Could not save radio')
  }

  const heroArt = trackArtURL(seed)
  return <div className="min-h-full p-6 pb-10"><div className="mx-auto max-w-5xl space-y-7">
    <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-muted hover:text-white"><ArrowLeft size={15} />Back</button>
    <div className="flex flex-col gap-5 @md:flex-row @md:items-end"><div className="h-36 w-36 overflow-hidden rounded-xl bg-card shadow-xl">{heroArt ? <FadeImg src={heroArt} className="h-full w-full object-cover" /> : <RadioIcon size={38} className="m-12 text-accent" />}</div><div><p className="text-[11px] font-display uppercase tracking-[0.3em] text-accent">Radio</p><h1 className="mt-2 text-3xl font-medium text-white">{location.state?.name || 'Song Radio'}</h1><p className="mt-2 text-sm text-muted">A continuous mix based on {seed?.title || seed?.artist || 'your selection'}.</p><div className="mt-4 flex gap-2"><button type="button" onClick={() => playQueue(tracks, 0, { type: 'radio', name: location.state?.name || 'Radio' })} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-medium text-black"><Play size={15} fill="currentColor" />Play radio</button><button type="button" onClick={regenerate} disabled={loading} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white/75"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />Regenerate</button><button type="button" onClick={save} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white/75"><ListPlus size={15} />Save</button></div></div></div>
    <TrackList tracks={tracks} reduceMotion />
  </div></div>
}
