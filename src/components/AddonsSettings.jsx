// Settings → Addons: install online sources by pasting a manifest URL
// (Eclipse Music–compatible addons), turn them on/off, edit the settings
// they declare, remove them. Installed addons show up as sources next to
// YouTube Music and SoundCloud above the online results in search.

import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Blocks, Loader2, Trash2 } from 'lucide-react'
import { api } from '../api'
import { peekCache, usePageReady, writeCache } from '../pageCache'

const changed = () => window.dispatchEvent(new Event('lokal:addons-changed'))

/** One field from an addon's manifest "settings". */
function SettingField({ field, value, onChange }) {
  const id = `addon-setting-${field.key}`
  const label = <label htmlFor={id} className="text-xs font-medium text-text">{field.label || field.key}</label>
  const help = field.help ? <p className="text-[11px] leading-relaxed text-muted">{field.help}</p> : null
  if (field.type === 'toggle') {
    const on = value === true || value === 'true'
    return (
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">{label}{help}</div>
        <button id={id} role="switch" aria-checked={on} onClick={() => onChange(!on)}
          className={`flex-shrink-0 rounded-lg border px-3 py-1 text-[11px] font-display uppercase tracking-wider transition-colors ${on ? 'border-accent/50 bg-accent/20 text-accent' : 'border-border text-muted hover:text-text'}`}>
          {on ? 'On' : 'Off'}
        </button>
      </div>
    )
  }
  if (field.type === 'select') {
    return (
      <div className="space-y-1">
        {label}
        <select id={id} value={String(value ?? '')} onChange={e => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-text outline-none focus:border-accent/50">
          {(field.options || []).map(o => <option key={String(o.value)} value={String(o.value)}>{o.label || o.value}</option>)}
        </select>
        {help}
      </div>
    )
  }
  return (
    <div className="space-y-1">
      {label}
      <input id={id} type={field.type === 'number' ? 'number' : 'text'} value={String(value ?? '')} placeholder={field.placeholder || ''}
        onChange={e => onChange(field.type === 'number' ? e.target.value : e.target.value)}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-text outline-none focus:border-accent/50" />
      {help}
    </div>
  )
}

/** An installed addon: header, on/off, remove, and its settings. */
function AddonCard({ addon, onChanged }) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState(addon.settings || {})
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => { setValues(addon.settings || {}) }, [addon.settings])

  const update = async (key, value) => {
    const next = { ...values, [key]: value }
    setValues(next)
    await api.addonsSetSettings(addon.key, next)
  }
  const toggle = async () => {
    setBusy(true)
    await api.addonsSetEnabled(addon.key, !addon.enabled)
    setBusy(false)
    onChanged()
  }
  const remove = async () => {
    setBusy(true)
    await api.addonsRemove(addon.key)
    setBusy(false)
    onChanged()
  }

  return (
    <div className={`rounded-xl border border-border bg-card/60 p-4 ${addon.enabled ? '' : 'opacity-70'}`}>
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-elevated">
          {addon.icon ? <img src={addon.icon} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <div className="flex h-full w-full items-center justify-center text-muted"><Blocks size={16} /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text">{addon.name} <span className="text-xs font-normal text-muted">v{addon.version}</span></p>
          <p className="text-[11px] text-muted">{addon.host}</p>
          {addon.description && <p className="mt-1 text-xs leading-relaxed text-muted">{addon.description}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button onClick={toggle} disabled={busy}
            className={`rounded-lg border px-3 py-1 text-[11px] font-display uppercase tracking-wider transition-colors ${addon.enabled ? 'border-accent/50 bg-accent/20 text-accent' : 'border-border text-muted hover:text-text'}`}>
            {addon.enabled ? 'On' : 'Off'}
          </button>
          {confirmRemove ? (
            <button onClick={remove} disabled={busy} className="rounded-lg border border-red/40 px-2.5 py-1 text-[11px] text-red hover:bg-red/10">Remove?</button>
          ) : (
            <button onClick={() => setConfirmRemove(true)} title="Remove addon" aria-label={`Remove ${addon.name}`} className="p-1 text-muted hover:text-red"><Trash2 size={14} /></button>
          )}
        </div>
      </div>
      {addon.settingsSchema.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setOpen(v => !v)} className="text-xs text-accent hover:underline">{open ? 'Hide settings' : `Settings (${addon.settingsSchema.length})`}</button>
          {open && (
            <div className="mt-3 space-y-3 border-t border-border pt-3">
              {addon.settingsSchema.filter(f => f?.key).map(field => (
                <SettingField key={field.key} field={field} value={values[field.key] ?? field.default} onChange={v => update(field.key, v)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** The Addons section. */
export default function AddonsSettings() {
  // Last visit's list shows at once; the Settings category fades in once
  // the list is in (it used to appear empty for a frame first).
  const [addons, setAddons] = useState(() => peekCache('settings:addons') ?? null)
  usePageReady(addons !== null)
  const [url, setUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [message, setMessage] = useState(null) // { error?, text }

  // Only the latest request applies; a failed one keeps the list shown.
  const loadRequest = useRef(0)
  const load = () => {
    const request = ++loadRequest.current
    const failed = () => { if (request === loadRequest.current) setAddons(prev => prev ?? []) }
    return Promise.resolve(api.addonsList?.()).then(list => {
      if (request !== loadRequest.current) return
      if (!Array.isArray(list)) return failed()
      writeCache('settings:addons', list)
      setAddons(list)
    }).catch(failed)
  }
  useEffect(() => { load() }, [])
  const onChanged = () => { load(); changed() }

  const install = async () => {
    if (!url.trim()) return
    setInstalling(true)
    setMessage(null)
    const result = await Promise.resolve(api.addonsInstall(url.trim())).catch(e => ({ error: e.message }))
    setInstalling(false)
    if (result?.error) { setMessage({ error: true, text: result.error }); return }
    setMessage({ text: `${result.name} installed. It's now a source above the online results in search.` })
    setUrl('')
    onChanged()
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted">
        Add online sources by pasting an addon's manifest URL (addons made for Eclipse Music work). An addon's results show up as a source next to YouTube Music and SoundCloud in search, and its songs can be played, added to playlists and saved to your library.
      </p>
      <div className="flex items-start gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3">
        <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-yellow-300" />
        <p className="text-[11px] leading-relaxed text-text/80">
          Addons are made and run by third parties. Lokal doesn't host, check or vouch for any of them, and you're responsible for the ones you add. Only add addons you trust and are allowed to use where you live. An addon URL can contain a personal token: don't share it.
        </p>
      </div>
      <div className="flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && install()}
          placeholder="https://example.com/…/manifest.json" spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-xs text-text outline-none focus:border-accent/50 placeholder:text-muted" />
        <button onClick={install} disabled={installing || !url.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-[rgb(var(--bg-rgb))] transition-colors hover:bg-accent/80 disabled:opacity-40">
          {installing && <Loader2 size={12} className="animate-spin" />} Install
        </button>
      </div>
      {message && <p className={`text-xs ${message.error ? 'text-red' : 'text-accent'}`}>{message.text}</p>}
      {addons === null ? null : addons.length === 0 ? (
        <p className="text-xs text-muted">No addons installed.</p>
      ) : (
        <div className="space-y-3">
          {addons.map(addon => <AddonCard key={addon.key} addon={addon} onChanged={onChanged} />)}
        </div>
      )}
    </div>
  )
}
