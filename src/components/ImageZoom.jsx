// A cover or artist picture, big: click it on an album or artist page and it
// opens over the app (like streaming apps do); a click anywhere or Escape
// closes it. Online pictures are asked for in a larger size where the source
// allows (YouTube/Google, iTunes).

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

/** The same picture in a larger size, when the URL says its size. */
export function largerImage(url) {
  const src = String(url || '')
  if (!/^https:\/\//.test(src)) return src
  // Google (YouTube Music, lh3...): "=w120-h120-l90-rj" -> 1200 square.
  if (/googleusercontent\.com|ggpht\.com/.test(src)) return src.replace(/=w\d+-h\d+[^/?#]*$/, '=w1200-h1200-l90-rj').replace(/=s\d+[^/?#]*$/, '=s1200')
  // iTunes / Apple Music: ".../600x600bb.jpg" -> 1200.
  if (/mzstatic\.com/.test(src)) return src.replace(/\/\d+x\d+(bb|cc)?(\.\w+)$/, '/1200x1200$1$2')
  return src
}

/**
 * @param src     the picture shown (opened as is if no larger one loads)
 * @param alt     what it is
 * @param open / onClose
 */
export default function ImageZoom({ src, alt = '', open, onClose }) {
  const big = largerImage(src)
  const [shown, setShown] = useState(big)
  useEffect(() => { setShown(big) }, [big])
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return createPortal(
    <AnimatePresence>
      {open && src && (
        <motion.div
          key="image-zoom"
          role="dialog"
          aria-modal="true"
          aria-label={alt || 'Picture'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-8"
        >
          <motion.img
            src={shown}
            alt={alt}
            onError={() => { if (shown !== src) setShown(src) }}
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="max-h-[min(80vh,900px)] max-w-[min(80vw,900px)] rounded-2xl object-contain shadow-2xl"
          />
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white/80 transition-colors hover:bg-white/20 hover:text-white">
            <X size={18} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
