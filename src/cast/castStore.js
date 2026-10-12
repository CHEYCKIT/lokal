// Casting, for the interface: the devices found, the session's status as the
// main process reports it (electron/ipc/cast.js), and the start and end of a
// session. What plays where is src/cast/useCastPlayback.js's.

import { create } from 'zustand'
import { api } from '../api'

export const useCastStore = create((set, get) => ({
  available: api.castAvailable(),
  devices: [],
  status: { state: 'idle' },
  // The device being connected to (the menu shows it spinning).
  connecting: null,
  error: null,
  // A session that just started: { joined, at }. The player takes over from it.
  session: null,
  // A session that just ended: { reason: 'local'|'stopped'|'lost', last, at }.
  ended: null,
  // What Lokal's receiver shows: 'nowplaying' (with Up Next), 'lyrics' or
  // 'video' (the music video, when the song has one; else Now playing).
  tvView: readTvView(),

  setTvView: view => {
    const tvView = view === 'lyrics' || view === 'video' ? view : 'nowplaying'
    if (tvView === get().tvView) return
    try { localStorage.setItem('lokal-cast-view', tvView) } catch {}
    set({ tvView })
  },

  setDevices: devices => set({ devices: Array.isArray(devices) ? devices : [] }),
  setStatus: status => set({ status: status || { state: 'idle' } }),

  /** The list (and a few seconds of looking hard: the menu is open). */
  refresh: async () => {
    const devices = await api.castDevices().catch(() => [])
    get().setDevices(devices)
    return devices
  },

  connect: async deviceId => {
    if (get().connecting) return
    set({ connecting: deviceId, error: null })
    try {
      const result = await api.castConnect(deviceId)
      if (result?.error) throw new Error(result.error)
      set({ connecting: null, status: result.status, session: { joined: !!result.joined, at: Date.now() } })
    } catch (error) {
      set({ connecting: null, error: friendly(error) })
    }
  },

  /** Back to this computer: the TV's app is closed and the song carries on here, from where it was. */
  disconnect: async () => {
    const last = await api.castDisconnect({ stopReceiver: true }).catch(() => null)
    set({ ended: { reason: 'local', last: last || get().status, at: Date.now() }, session: null })
  },

  /** The main process ended it (the TV was switched off, its app closed, the network went). */
  endedRemotely: info => set({ ended: { reason: info?.reason || 'lost', last: info?.last || get().status, at: Date.now() }, session: null }),

  addDevice: async address => {
    const result = await api.castAddDevice(address)
    if (result?.error) throw new Error(friendly(result))
    await get().refresh()
    return result
  },

  removeDevice: async id => {
    await api.castRemoveDevice(id)
    await get().refresh()
  },
}))

function readTvView() {
  try { const view = localStorage.getItem('lokal-cast-view'); return view === 'lyrics' || view === 'video' ? view : 'nowplaying' } catch { return 'nowplaying' }
}

function friendly(error) {
  const message = String(error?.message || error?.error || error || '')
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Something went wrong'
}

/** Whether a device is a TV, a speaker or a group (the menu's icons). */
export const deviceKind = device => (device?.kind === 'group' ? 'group' : device?.kind === 'speaker' ? 'speaker' : 'tv')
