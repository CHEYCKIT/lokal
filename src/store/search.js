// The search box lives in the window header now, while its results are the
// Search page: both read the query from here. `focusSeq` goes up whenever
// something (typing anywhere, Ctrl+K, "/") wants the header box focused.

import { create } from 'zustand'

export const useSearchStore = create((set) => ({
  query: '',
  focusSeq: 0,
  setQuery: (query) => set({ query }),
  requestFocus: () => set((s) => ({ focusSeq: s.focusSeq + 1 })),
}))
