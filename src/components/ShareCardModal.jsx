// The share card dialog: the picture (src/shareCard.js), to copy or save.

import React, { useEffect, useState } from 'react'
import { Copy, Download, Check, Loader2 } from 'lucide-react'
import Modal from './Modal'
import { renderShareCard } from '../shareCard'

const safeName = (name) => String(name || 'lokal').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'lokal'

export default function ShareCardModal() {
  const [spec, setSpec] = useState(null)
  const [card, setCard] = useState(null) // { url, blob } | { error }
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const open = (e) => { if (e.detail) { setSpec(e.detail); setCard(null); setCopied(false) } }
    window.addEventListener('lokal:share-card', open)
    return () => window.removeEventListener('lokal:share-card', open)
  }, [])

  useEffect(() => {
    if (!spec) return undefined
    let alive = true
    let url = null
    renderShareCard(spec)
      .then(canvas => new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not make the picture'))), 'image/png')))
      .then(blob => {
        url = URL.createObjectURL(blob)
        if (alive) setCard({ url, blob })
        else URL.revokeObjectURL(url)
      })
      .catch(e => { if (alive) setCard({ error: e.message }) })
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [spec])

  const close = () => setSpec(null)

  const copy = async () => {
    if (!card?.blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': card.blob })])
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (e) {
      setCard(c => ({ ...c, copyError: 'Copying pictures isn\'t allowed here: save it instead.' }))
    }
  }

  const save = () => {
    if (!card?.url) return
    const link = document.createElement('a')
    link.href = card.url
    link.download = `${safeName(spec?.fileName || spec?.title)} - Lokal.png`
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return (
    <Modal open={!!spec} onClose={close} title={`Share ${String(spec?.kind || '').toLowerCase()}`} width="max-w-md">
      <div className="space-y-4">
        <div className="mx-auto aspect-[4/5] w-full max-w-[340px] overflow-hidden rounded-xl border border-border bg-card">
          {card?.url
            ? <img src={card.url} alt={`Share card for ${spec?.title || ''}`} className="h-full w-full object-cover" />
            : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted">
                {card?.error ? card.error : <Loader2 size={18} className="animate-spin" />}
              </div>
            )}
        </div>
        {card?.copyError && <p className="text-center text-[11px] text-muted">{card.copyError}</p>}
        <div className="flex gap-2">
          <button onClick={copy} disabled={!card?.blob}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-white/85 hover:text-white disabled:opacity-40">
            {copied ? <Check size={15} className="text-accent" /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy image'}
          </button>
          <button onClick={save} disabled={!card?.url}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-base hover:bg-accent-dim disabled:opacity-40">
            <Download size={15} /> Save image
          </button>
        </div>
      </div>
    </Modal>
  )
}
