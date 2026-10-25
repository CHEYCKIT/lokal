// The search box lives in the window header now, while its results are the
// Search page: both read the query from here. `focusSeq` goes up whenever
// something (typing anywhere, Ctrl+K, "/") wants the header box focused;
// `submitSeq` whenever Enter is pressed in it (a pasted link downloads), and
// `pendingSubmit` the link it was pressed on until the Search page takes it
// (Enter can come before the page has appeared).

import { create } from 'zustand'

/** Shared search state: the header's query and focus requests. */
import { normalizeSearchScope, searchesOnline } from '../searchScope.mjs'
import { normalizeResultCategory } from '../searchResultCategory.mjs'

const SCOPE_KEY = 'lokal-search-scope'
const CATEGORY_KEY = 'lokal-search-result-category'
const readCategory = () => {
  try { return normalizeResultCategory(localStorage.getItem(CATEGORY_KEY)) }
  catch { return 'songs' }
}
// Retired All-source selections migrate to Library; the category-type All
// still remains. Explicit Online survives upgrades.
const readScope = () => {
  try {
    const saved = localStorage.getItem(SCOPE_KEY)
    if (saved === 'library' || saved === 'online') return saved
    return 'library'
  } catch { return 'library' }
}
const initialScope = readScope()

export const useSearchStore = create((set) => ({
  query: '',
  scope: initialScope,
  resultCategory: readCategory(),
  setResultCategory: (value) => {
    const resultCategory = normalizeResultCategory(value)
    try { localStorage.setItem(CATEGORY_KEY, resultCategory) } catch {}
    set({ resultCategory })
  },
  // Deprecated compatibility shape for components still checking the old
  // globe setting. The search screen uses scope exclusively.
  online: searchesOnline(initialScope),
  setScope: (value) => {
    const scope = normalizeSearchScope(value)
    try { localStorage.setItem(SCOPE_KEY, scope) } catch {}
    set({ scope, online: searchesOnline(scope) })
  },
  setOnline: (value) => {
    const scope = value ? 'online' : 'library'
    try { localStorage.setItem(SCOPE_KEY, scope) } catch {}
    set({ scope, online: searchesOnline(scope) })
  },
  focusSeq: 0,
  submitSeq: 0,
  pendingSubmit: null,
  /** Replace the search text. */
  setQuery: (query) => set({ query }),
  /** Ask the header search box to take focus. */
  requestFocus: () => set((s) => ({ focusSeq: s.focusSeq + 1 })),
  /** Enter was pressed in the header search box, on `link`. */
  submit: (link = null) => set((s) => ({ submitSeq: s.submitSeq + 1, pendingSubmit: link })),
  /** Take the Enter pressed on `link`, if it's still waiting: true when it was. */
  takeSubmit: (link) => {
    if (!link || useSearchStore.getState().pendingSubmit !== link) return false
    set({ pendingSubmit: null })
    return true
  },
}))
