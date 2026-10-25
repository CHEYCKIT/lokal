import React, { useEffect, useState } from 'react'
import { User } from 'lucide-react'
import { api } from '../api'
import QualityImage from './QualityImage'

// Search portraits use independently verified artist imagery, never the
// cover of a random song or an unverified namesake's album.
const normalize = value => String(value || '').normalize('NFKC')
  .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const portraitCache = new Map()
const MAX_CACHE = 150
function portrait(name) {
  const key = normalize(name)
  if (!key) return Promise.resolve('')
  const existing = portraitCache.get(key)
  if (existing && existing.expires > Date.now()) return existing.promise
  const promise = Promise.resolve(api.artistSearchMetadata(name, { source: 'deezer' }))
    .then(rows => {
      const row = Array.isArray(rows) ? rows.find(row => normalize(row?.title) === key) : null
      const image = String(row?.imageUrl || '')
      return /^https:\/\//.test(image) ? image : ''
    }).catch(() => '')
  portraitCache.set(key, { promise, expires: Date.now() + 15 * 60_000 })
  while (portraitCache.size > MAX_CACHE) portraitCache.delete(portraitCache.keys().next().value)
  return promise
}

/** Prefer stored artist portrait, then exact-name Deezer artist image.
 * Fetches are cached, bounded and do not block listing the text results. */
export default function SearchArtistPortrait({ name, localPath, imageUrl, className = 'w-full h-full object-cover' }) {
  const [external, setExternal] = useState('')
  const [brokenLocal, setBrokenLocal] = useState(false)
  const [brokenRemote, setBrokenRemote] = useState(false)
  const local = localPath && !brokenLocal
    ? (api.isElectron ? `file://${localPath}` : null) : null
  const known = /^https:\/\//.test(String(imageUrl || '')) ? imageUrl : ''
  useEffect(() => {
    setExternal(''); setBrokenLocal(false); setBrokenRemote(false)
  }, [name, localPath, known])
  useEffect(() => {
    let alive = true
    if (!known && (!localPath || !api.isElectron || brokenLocal)) {
      portrait(name).then(value => { if (alive) setExternal(value) })
    }
    return () => { alive = false }
  }, [name, known, localPath, brokenLocal])
  if (local) return <img src={local} alt={name} className={className} onError={() => setBrokenLocal(true)} />
  const url = known || external
  return url && !brokenRemote
    ? <QualityImage src={url} alt={name} className={className} onError={() => setBrokenRemote(true)} />
    : <User size={20} aria-label={name} />
}
