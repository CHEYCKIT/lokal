import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, Loader2 } from 'lucide-react'
import { applyLoadingToastEvent, currentLoadingToast } from '../loadingToastState.mjs'

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
export function showLoadingToast(message, progress = null) {
  const id = `loading:${Date.now()}:${Math.random()}`
  let closed = false
  let currentProgress = null
  const send = (text, update = false, nextProgress) => {
    if (closed) return
    // undefined preserves the previous measurement for phase/status messages;
    // null explicitly resets it, and invalid numbers are never displayed.
    if (nextProgress !== undefined) {
      const percent = typeof nextProgress === 'number' ? nextProgress : nextProgress?.percent
      currentProgress = Number.isFinite(percent) && percent >= 0 && percent <= 100
        ? Math.round(percent) : null
    }
    window.dispatchEvent(new CustomEvent(TOAST_EVENT, {
      detail: { id, message: String(text), loading: true, update, progress: currentProgress },
    }))
  }
  send(message, false, progress)
  return {
    update: (text, nextProgress) => send(text, true, nextProgress),
    close: message => {
      if (closed) return
      closed = true
      window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { finish: id, message: message || '' } }))
    },
  }
}

export default function Toaster() {
  const [toast, setToast] = useState(null)
  const [loadingToast, setLoadingToast] = useState(null)
  const pendingLoading = useRef(new Map())
  const timer = useRef(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    let seq = 0
    const syncLoading = () => setLoadingToast(currentLoadingToast(pendingLoading.current))
    const onToast = (event) => {
      const detail = event.detail || {}
      const update = applyLoadingToastEvent(pendingLoading.current, detail)
      if (update.handled) {
        syncLoading()
        if (!update.confirmation) return
      }
      clearTimeout(timer.current)
      const id = ++seq
      setToast({ id, message: detail.message || '' })
      timer.current = setTimeout(() => setToast(now => now?.id === id ? null : now), VISIBLE_MS)
    }
    window.addEventListener(TOAST_EVENT, onToast)
    return () => { window.removeEventListener(TOAST_EVENT, onToast); clearTimeout(timer.current) }
  }, [])

  const hidden = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[210] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      <AnimatePresence>
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
            {toast.loading && Number.isFinite(toast.progress) && (
              <span className="flex-shrink-0 tabular-nums font-semibold text-accent" aria-label={`Progress ${toast.progress} percent`}>
                {toast.progress}%
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {loadingToast && (
          <motion.div key={loadingToast.id}
            initial={hidden} animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="flex max-w-[min(28rem,100%)] items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs text-white shadow-xl"
          >
            <Loader2 size={13} className="flex-shrink-0 animate-spin text-accent" />
            <span className="truncate">{loadingToast.message}</span>
            {Number.isFinite(loadingToast.progress) && (
              <span className="flex-shrink-0 tabular-nums font-semibold text-accent"
                aria-label={`Progress ${loadingToast.progress} percent`}>{loadingToast.progress}%</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body
  )
}
