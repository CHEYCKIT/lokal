let status = { verified: false, connected: false, error: '' }
let revision = 0
export const youtubeAccountStatusRevision = () => revision
const listeners = new Set()
export const getYoutubeAccountStatus = () => status
export const subscribeYoutubeAccountStatus = listener => { listeners.add(listener); return () => listeners.delete(listener) }
export function updateYoutubeAccountStatus(result, version = revision) {
  if (version !== revision) return
  status = { verified: true, connected: !result?.error && result?.authenticated !== false, error: result?.error || '' }
  listeners.forEach(listener => listener())
}
export function clearYoutubeAccountStatus() {
  revision++
  status = { verified: false, connected: false, error: '' }
  listeners.forEach(listener => listener())
}
