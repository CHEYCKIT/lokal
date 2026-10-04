import React, { useEffect, useRef, useState } from 'react'
import { Music } from 'lucide-react'
import { api } from '../api'
import FadeImg from './FadeImg'

export default function DiscoveryImage({ item, type = 'track', src, className = '', fallback = null }) {
  const [replacement, setReplacement] = useState('')
  const [failed, setFailed] = useState(false)
  const request = useRef(0)
  useEffect(() => { request.current++; setReplacement(''); setFailed(false); return () => { request.current++ } }, [src])
  const retry = async () => {
    setFailed(true)
    if (replacement) return
    const version = ++request.current
    const [result] = await api.discoveryArtwork([{ type, title: item.title, artist: type === 'artist' ? item.name : item.artist, exclude: src }]).catch(() => [])
    if (version !== request.current) return
    if (result?.image && result.image !== src) { setReplacement(result.image); setFailed(false) }
  }
  if ((!src && !replacement) || failed) return fallback || <div className="flex h-full w-full items-center justify-center text-muted"><Music size={28} /></div>
  return <FadeImg src={replacement || src} className={className} onError={retry} />
}
