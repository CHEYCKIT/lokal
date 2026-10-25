// Search's source scope is a single choice, not two independent toggles.
// Playback source priority and the user's selected Global catalogue stay
// independent of this filtering decision.
export const SEARCH_SCOPES = Object.freeze(['all', 'library', 'online'])
export const normalizeSearchScope = value => SEARCH_SCOPES.includes(value) ? value : 'all'
export const searchesLibrary = scope => normalizeSearchScope(scope) !== 'online'
export const searchesOnline = scope => normalizeSearchScope(scope) !== 'library'
export const scopeDescription = scope => normalizeSearchScope(scope) === 'online'
  ? 'Search online catalogues and playback sources'
  : normalizeSearchScope(scope) === 'library'
    ? 'Search only your library'
    : 'Search your library and online catalogues'
