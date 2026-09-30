// The search box lives in the window header now, while its results are the
// Search page: both read the query from here. `focusSeq` goes up whenever
// something (typing anywhere, Ctrl+K, "/") wants the header box focused;
// `submitSeq` whenever Enter is pressed in it (a pasted link downloads).

import { create } from 'zustand'

/** Shared search state: the header's query and focus requests. */
export const useSearchStore = create((set) => ({
  query: '',
  focusSeq: 0,
  submitSeq: 0,
  /** Replace the search text. */
  setQuery: (query) => set({ query }),
  /** Ask the header search box to take focus. */
  requestFocus: () => set((s) => ({ focusSeq: s.focusSeq + 1 })),
  /** Enter was pressed in the header search box. */
  submit: () => set((s) => ({ submitSeq: s.submitSeq + 1 })),
}))
