import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// The online radio station list's columns (src/radio/stationColumns.js), per
// local profile, kept apart from the song lists' (lokal-track-columns-v1).
export const useStationColumnsStore = create(persist((set) => ({
  profiles: {},
  setColumn: (profile, key, value) => set(state => ({
    profiles: { ...state.profiles, [profile]: { ...state.profiles[profile], [key]: value } },
  })),
  resetColumns: (profile) => set(state => {
    const profiles = { ...state.profiles }
    delete profiles[profile]
    return { profiles }
  }),
}), {
  name: 'lokal-station-columns-v1',
  storage: createJSONStorage(() => ({
    getItem: key => { try { return localStorage.getItem(key) } catch { return null } },
    setItem: (key, value) => { try { localStorage.setItem(key, value) } catch {} },
    removeItem: key => { try { localStorage.removeItem(key) } catch {} },
  })),
  partialize: state => ({ profiles: state.profiles }),
}))
