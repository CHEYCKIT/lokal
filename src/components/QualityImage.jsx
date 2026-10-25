import React, { useEffect, useState } from 'react'
import FadeImg from './FadeImg'
import { artworkCandidates } from '../artworkQuality.mjs'

/** Request a larger rendition of the same online artwork first, but fall back
 * through provider-supported sizes before treating the image as missing.
 * Used for Discovery, album/shelf art and full-player surfaces.
 */
export default function QualityImage({ src, onError, ...props }) {
  const variants = artworkCandidates(src)
  const [index, setIndex] = useState(0)
  useEffect(() => { setIndex(0) }, [src])
  const failed = () => {
    if (index + 1 < variants.length) setIndex(index + 1)
    else onError?.()
  }
  return <FadeImg {...props} src={variants[Math.min(index, variants.length - 1)] || src}
    onError={failed} />
}
