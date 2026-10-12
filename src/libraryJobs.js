// Library jobs that run in the background (Settings → Library has their
// switches too): Index Lyrics and Fill In Genres, followed here for the whole
// app so the Downloads panel can show and start them.
import { create } from 'zustand'
import { api } from './api.js'

export const useLibraryJobs = create(() => ({
  // Index Lyrics: { running, done, total, found, title?, cancelled? } or null before any.
  lyrics: null,
  // Fill In Genres: { running, done, total, songs, updated, started?, error? } or null before it's read.
  genres: null,
}))

let listening = false
function listen() {
  if (listening) return
  listening = true
  api.onLyricsIndexProgress(progress => { if (progress) useLibraryJobs.setState({ lyrics: progress }) })
}
listen()

export async function startLyricsIndex() {
  if (useLibraryJobs.getState().lyrics?.running) return
  useLibraryJobs.setState({ lyrics: { running: true, done: 0, total: 0, found: 0 } })
  // Answers when the whole job is done; progress comes as events meanwhile.
  const result = await Promise.resolve(api.indexAllLyrics()).catch(() => null)
  if (!result) useLibraryJobs.setState(state => ({ lyrics: state.lyrics?.running && !state.lyrics.total ? null : state.lyrics }))
}

export const cancelLyricsIndex = () => Promise.resolve(api.cancelLyricsIndex()).catch(() => null)

/** Reads Fill In Genres' progress, and keeps reading it every few seconds while it runs. */
let genresTimer = null
export async function readGenresStatus() {
  clearTimeout(genresTimer)
  const status = await Promise.resolve(api.genresStatus?.()).catch(() => null)
  // Two reads at once (the panel opening as the job starts): one poll, not two.
  clearTimeout(genresTimer)
  if (!status || status.error) return
  useLibraryJobs.setState(state => ({ genres: { ...status, started: state.genres?.started } }))
  if (status.running) genresTimer = setTimeout(readGenresStatus, 2500)
}

export async function startGenres() {
  if (useLibraryJobs.getState().genres?.running) return
  const status = await Promise.resolve(api.fetchMissingGenres()).catch(error => ({ error: error?.message || 'Could not start' }))
  useLibraryJobs.setState({ genres: status?.error ? { error: status.error } : { ...status, started: true } })
  if (!status?.error) readGenresStatus()
}
