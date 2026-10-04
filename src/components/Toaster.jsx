import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, Loader2 } from 'lucide-react'

// A short confirmation that slides up above the player bar ("Added to
// queue"), from anywhere: showToast('...') and the one <Toaster /> in App
// shows it. A new message replaces the one on screen.

const TOAST_EVENT = 'lokal:toast'
const VISIBLE_MS = 2200

export function showToast(message) {
  if (!message) return
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message: String(message) } }))
}

/** A request-owned loading toast stays visible until that request completes. */
export function showLoadingToast(message) {
  const id = `loading:${Date.now()}:${Math.random()}`
  const send = text => window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { id, message: String(text), loading: true } }))
  send(message)
  return { update: send, close: message => window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { finish: id, message: message || '' } })) }
}

export default function Toaster() {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    let seq = 0
    const onToast = (event) => {
      const detail = event.detail || {}
      if (detail.finish) {
        setToast(previous => {
          if (previous?.id !== detail.finish) return previous
          clearTimeout(timer.current)
          if (!detail.message) return null
          timer.current = setTimeout(() => setToast(null), VISIBLE_MS)
          return { id: ++seq, message: detail.message }
        })
        return
      }
      clearTimeout(timer.current)
      setToast({ id: detail.id || ++seq, message: detail.message || '', loading: !!detail.loading })
      if (!detail.loading) timer.current = setTimeout(() => setToast(null), VISIBLE_MS)
    }
    window.addEventListener(TOAST_EVENT, onToast)
    return () => { window.removeEventListener(TOAST_EVENT, onToast); clearTimeout(timer.current) }
  }, [])

  const hidden = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[210] flex justify-center px-4" role="status" aria-live="polite">
      <AnimatePresence mode="wait">
        {toast && (
          <motion.div
            key={toast.id}
            initial={hidden}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="flex max-w-[min(28rem,100%)] items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs text-white shadow-xl"
          >
            {toast.loading ? <Loader2 size={13} className="flex-shrink-0 animate-spin text-accent" /> : <Check size={13} className="flex-shrink-0 text-accent" />}
            <span className="truncate">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body
  )
}
