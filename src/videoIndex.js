// Finding the music video of every library song (Videos > Find videos for my
// library) runs in the main process; this follows its progress for the whole
// app, so the Videos page and the Downloads panel show the same job.
import { create } from 'zustand'
import { api } from './api.js'

export const useVideoIndex = create(() => ({
  // { running, done, total, found, title?, cancelled? } or null before any.
  progress: null,
}))

let listening = false
function listen() {
  if (listening) return
  listening = true
  api.onMusicVideoIndexProgress(progress => { if (progress) useVideoIndex.setState({ progress }) })
  // A job started before this window loaded (a reload mid-job).
  Promise.resolve(api.musicVideoIndexStatus()).then(progress => {
    if (progress && !useVideoIndex.getState().progress) useVideoIndex.setState({ progress })
  }).catch(() => {})
}
listen()

export const videoIndexRunning = state => (state.progress?.running ? state.progress : null)

/** Starts the job; answers { error } when it couldn't. */
export async function startVideoIndex() {
  const { progress } = useVideoIndex.getState()
  if (!progress?.running) useVideoIndex.setState({ progress: { running: true, done: 0, total: 0, found: 0 } })
  const result = await Promise.resolve(api.indexAllMusicVideos()).catch(error => ({ error: error.message }))
  // Didn't start (failed, or not available here): drop the placeholder.
  if (result?.error || !result) useVideoIndex.setState(state => ({ progress: state.progress?.running && !state.progress.total ? null : state.progress }))
  return result
}

export const cancelVideoIndex = () => Promise.resolve(api.cancelMusicVideoIndex()).catch(() => null)
