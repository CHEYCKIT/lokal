// Online radio: the station catalogue (kept by the main process in settings,
// see electron/ipc/radio.js) and what each station was last heard playing.

import { create } from 'zustand'
import { api } from '../api.js'
import { DEFAULT_RADIO_CATALOG_URL } from '../radio/stations.js'

export const RADIO_BUFFER_DEFAULT = 3
export const RADIO_BUFFER_MAX = 10

/** The buffer setting as seconds, 0-10 (3 when unset). */
export function radioBufferSeconds(value) {
  if (value == null || value === '') return RADIO_BUFFER_DEFAULT
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(RADIO_BUFFER_MAX, Math.max(0, n)) : RADIO_BUFFER_DEFAULT
}

export const useRadioStore = create((set, get) => ({
  url: '',
  catalog: null,
  updatedAt: 0,
  ready: false,
  loading: false,
  // stationId -> { artist, title, cover, album, year }
  nowPlaying: {},
  // stationId -> { bitrate, codec }
  streamInfo: {},

  init: async () => {
    if (get().ready) return
    try {
      const saved = await api.radioGetCatalog?.()
      set({ url: saved?.url || DEFAULT_RADIO_CATALOG_URL, catalog: saved?.catalog || null, updatedAt: saved?.updatedAt || 0, ready: true })
      // Nothing loaded yet (first run): the default list, so there are stations
      // without anyone having to find a link. A failure (offline) tries again next time.
      if (!saved?.catalog && !saved?.url) get().loadCatalog(DEFAULT_RADIO_CATALOG_URL)
    } catch {
      set({ ready: true })
    }
  },

  /** Download the catalogue: { ok, errors? }. A broken file keeps the stations already there. */
  loadCatalog: async (url) => {
    set({ loading: true })
    try {
      const result = await api.radioLoadCatalog(url)
      if (result?.ok) set({ url: result.url, catalog: result.catalog, updatedAt: result.updatedAt, ready: true })
      return result || { ok: false, errors: [{ path: '', code: 'network' }] }
    } catch (error) {
      return { ok: false, errors: [{ path: '', code: 'network', detail: String(error?.message || error) }] }
    } finally {
      set({ loading: false })
    }
  },

  setNowPlaying: (stationId, song) => set(state => ({ nowPlaying: { ...state.nowPlaying, [stationId]: song ? { ...state.nowPlaying[stationId], ...song } : undefined } })),
  setStreamInfo: (stationId, info) => set(state => ({ streamInfo: { ...state.streamInfo, [stationId]: { ...state.streamInfo[stationId], ...info } } })),
}))
