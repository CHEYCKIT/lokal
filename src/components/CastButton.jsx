// The Cast button in the window header (next to the search box's random
// button) and its menu: the TVs and speakers on the network, this computer,
// the TV's volume while casting, and adding a device by its address when it
// isn't found by itself (a guest network, a VPN, a firewall in the way).

import { useTranslation } from '../i18n'
import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Cast, Check, Laptop, Plus, Speaker, Tv, Users, Volume1, Volume2, VolumeX, X } from 'lucide-react'
import { useCastStore, deviceKind } from '../cast/castStore'
import { usePlayerStore } from '../store/player'

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

function DeviceIcon({ device, size = 16 }) {
  const { t } = useTranslation()
  const kind = deviceKind(device)
  if (kind === 'group') return <Users size={size} aria-hidden="true" />
  if (kind === 'speaker') return <Speaker size={size} aria-hidden="true" />
  return <Tv size={size} aria-hidden="true" />
}

function Spinner() {
  const { t } = useTranslation()
  return <span className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-accent/30 border-t-accent" aria-hidden="true" />
}

export default function CastButton() {
  const { t } = useTranslation()
  const available = useCastStore(s => s.available)
  const devices = useCastStore(s => s.devices)
  const status = useCastStore(s => s.status)
  const connecting = useCastStore(s => s.connecting)
  const error = useCastStore(s => s.error)
  const castActive = usePlayerStore(s => s.castActive)
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)
  const root = useRef(null)

  const connectedId = castActive ? status?.device?.id : null
  const connectedDevice = connectedId ? (devices.find(d => d.id === connectedId) || status.device) : null

  // The player bar's "Playing on" chip opens the menu.
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener('lokal:open-cast-menu', show)
    return () => window.removeEventListener('lokal:open-cast-menu', show)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false) } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    // Looking hard while the menu is open; devices appear as they answer.
    let alive = true
    setSearching(true)
    const { refresh } = useCastStore.getState()
    refresh()
    const again = setInterval(refresh, 5000)
    const settle = setTimeout(() => { if (alive) setSearching(false) }, 8000)
    return () => {
      alive = false
      clearInterval(again)
      clearTimeout(settle)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])

  if (!available) return null

  const choose = async device => {
    if (device.id === connectedId) return
    await useCastStore.getState().connect(device.id)
    if (!useCastStore.getState().error) setOpen(false)
  }

  const backHere = async () => {
    if (castActive) await useCastStore.getState().disconnect()
    setOpen(false)
  }

  const label = castActive
    ? `Casting to ${connectedDevice?.name || 'a device'}`
    : connecting ? 'Connecting…' : 'Cast to a TV or speaker'

  return (
    <div ref={root} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        data-cast-button
        className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors bg-elevated hover:bg-card ${castActive || open ? 'text-accent' : 'text-muted hover:text-text'}`}
      >
        <Cast size={15} strokeWidth={castActive ? 2.4 : 1.8} className={connecting ? 'animate-pulse' : ''} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label={t("Cast to")}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full right-0 mt-2 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-elevated p-2 shadow-2xl z-50"
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <p className="text-xs font-display uppercase tracking-wider text-muted">{t("Play on")}</p>
              {searching && <Spinner />}
            </div>

            <div className="space-y-0.5">
              <button type="button" role="menuitemradio" aria-checked={!castActive} onClick={backHere}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${!castActive ? 'bg-accent/15 text-accent' : 'text-text hover:bg-card'}`}>
                <Laptop size={16} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{t("This computer")}</span>
                {!castActive && <Check size={14} aria-hidden="true" />}
              </button>

              {devices.map(device => {
                const selected = device.id === connectedId
                const busy = connecting === device.id
                return (
                  <div key={device.id} className="group/device relative">
                    <button type="button" role="menuitemradio" aria-checked={selected}
                      disabled={!!connecting} onClick={() => choose(device)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${selected ? 'bg-accent/15 text-accent' : 'text-text hover:bg-card'} disabled:cursor-wait`}>
                      <DeviceIcon device={device} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" title={device.name}>{device.name}</span>
                        {(busy || selected || device.model) && (
                          <span className={`block truncate text-[11px] ${selected ? 'text-accent/80' : 'text-muted'}`}>
                            {busy ? 'Connecting…' : selected ? (status?.receiver === 'lokal' ? 'Playing · Lokal on the TV' : 'Playing') : device.model}
                          </span>
                        )}
                      </span>
                      {busy ? <Spinner /> : selected ? <Check size={14} aria-hidden="true" /> : null}
                    </button>
                    {device.manual && !selected && !busy && (
                      <button type="button" title={`Forget ${device.name}`} aria-label={`Forget ${device.name}`}
                        onClick={() => useCastStore.getState().removeDevice(device.id)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-muted hover:text-text opacity-0 group-hover/device:opacity-100 focus:opacity-100">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            {!devices.length && (
              <p className="px-2.5 py-2 text-xs leading-relaxed text-muted">
                {searching ? 'Looking for TVs and speakers…' : 'No TVs or speakers found. Check that the TV is on and on the same Wi-Fi as this computer.'}
              </p>
            )}

            {castActive && <TvVolume />}
            {castActive && status?.receiver === 'lokal' && <TvView />}

            {error && <p role="alert" className="px-2.5 pt-2 text-xs text-red-400">{error}</p>}

            <div className="mt-1 border-t border-border pt-1">
              {adding
                ? <AddByAddress onDone={() => setAdding(false)} />
                : (
                  <button type="button" onClick={() => setAdding(true)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-muted hover:text-text hover:bg-card transition-colors">
                    <Plus size={14} aria-hidden="true" />
                    Add a device by its IP address
                  </button>
                )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TvVolume() {
  const { t } = useTranslation()
  const volume = usePlayerStore(s => s.volume)
  const setVolume = usePlayerStore(s => s.setVolume)
  const Icon = volume <= 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  return (
    <div className="mt-1 flex items-center gap-2.5 px-2.5 py-2">
      <Icon size={15} className="flex-shrink-0 text-muted" aria-hidden="true" />
      <input type="range" min="0" max="1" step="0.01" value={volume}
        onChange={e => setVolume(Number(e.target.value))}
        aria-label={t("TV volume")}
        className="flex-1 accent-accent cursor-pointer" />
      <span className="w-8 text-right text-[11px] tabular-nums text-muted">{Math.round(volume * 100)}</span>
    </div>
  )
}

function AddByAddress({ onDone }) {
  const { t } = useTranslation()
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const valid = IPV4.test(address.trim())

  const add = async event => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setProblem('')
    try {
      await useCastStore.getState().addDevice(address.trim())
      onDone()
    } catch (e) {
      setProblem(e?.message ? `No Cast device answered at ${address.trim()}.` : 'Couldn\'t add it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={add} className="px-2.5 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input autoFocus value={address} onChange={e => setAddress(e.target.value)} placeholder="192.168.1.40"
          aria-label={t("The device's IP address")} spellCheck={false} inputMode="decimal"
          className="min-w-0 flex-1 h-7 rounded-md bg-card border border-border px-2 text-xs text-text outline-none focus:border-accent/60" />
        <button type="submit" disabled={!valid || busy}
          className="h-7 px-2.5 rounded-md bg-accent text-base text-xs font-medium disabled:opacity-40">
          {busy ? <Spinner /> : 'Add'}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted">{problem || 'On Google TV: Settings → Network & Internet → your Wi-Fi network.'}</p>
    </form>
  )
}

// What Lokal's receiver shows on the TV.
function TvView() {
  const { t } = useTranslation()
  const view = useCastStore(s => s.tvView)
  const setTvView = useCastStore(s => s.setTvView)
  return (
    <div className="px-2.5 pb-2">
      <p className="mb-1.5 text-[11px] text-muted">{t("On the TV")}</p>
      <div role="radiogroup" aria-label={t("On the TV")} className="flex rounded-full bg-card p-0.5">
        {[['nowplaying', 'Now playing'], ['lyrics', 'Lyrics'], ['video', 'Video']].map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={view === value} onClick={() => setTvView(value)}
            title={value === 'video' ? 'The music video, when the song has one' : undefined}
            className={`flex-1 whitespace-nowrap rounded-full px-2 py-1 text-[11px] transition-colors ${view === value ? 'bg-accent text-base font-medium' : 'text-muted hover:text-text'}`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
