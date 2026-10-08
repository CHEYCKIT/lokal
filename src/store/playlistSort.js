import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

const DEFAULT_SORT = { column: 'number', direction: 'asc' }

export function playlistSortPreference(sort) {
  return ['number', 'added', 'time'].includes(sort?.column) && ['asc', 'desc'].includes(sort?.direction)
    ? sort : DEFAULT_SORT
}

// Save each playlist's view immediately, using the same storage as column preferences.
export const usePlaylistSortStore = create(persist(set => ({
  sorts: {},
  setSort: (playlist, sort) => set(state => ({
    sorts: { ...state.sorts, [playlist]: playlistSortPreference(sort) },
  })),
}), {
  name: 'lokal-playlist-sorts-v1',
  storage: createJSONStorage(() => ({
    getItem: key => { try { return localStorage.getItem(key) } catch { return null } },
    setItem: (key, value) => { try { localStorage.setItem(key, value) } catch {} },
    removeItem: key => { try { localStorage.removeItem(key) } catch {} },
  })),
  partialize: state => ({ sorts: state.sorts }),
}))
