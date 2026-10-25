// Search's two source modes are exclusive. The result-type "All" filter
// remains separate from this selector.
export const SEARCH_SCOPES = Object.freeze(['library', 'online'])
export const normalizeSearchScope = value => value === 'online' ? 'online' : 'library'
export const searchesLibrary = scope => normalizeSearchScope(scope) === 'library'
export const searchesOnline = scope => normalizeSearchScope(scope) === 'online'
export const scopeDescription = scope => normalizeSearchScope(scope) === 'online'
  ? 'Search online catalogues and playback sources'
  : 'Search only your library'
