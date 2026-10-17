// Why a song did or didn't start: written to the dev tools console and to
// Lokal's log, which `npm run dev` prints in the terminal ("[Renderer] [playback] ...").

import { api } from './api'

export function playbackLog(message, level = 'info') {
  const text = `[playback] ${message}`
  try { (level === 'warn' ? console.warn : console.info)(text) } catch {}
  try { api.log?.(level, text) } catch {}
}
