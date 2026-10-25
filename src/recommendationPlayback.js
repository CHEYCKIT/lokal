import { usePlayerStore } from './store/player.js'
import { playbackSources, resolveRecommendationTracks, songKey, uniqueSongs, isAddonVerificationRequiredError } from './recommendations.js'

function requestAddonVerification(error, retry) {
  if (!isAddonVerificationRequiredError(error) || typeof window === 'undefined') return false
  window.dispatchEvent(new CustomEvent('lokal:addon-verification-required', {
    detail: {
      key: error.key || String(error.provider || '').slice(2),
      provider: error.provider,
      title: error.title || 'this song',
      retry,
    },
  }))
  return true
}

/** Start one song promptly, then fill the same ordered queue in bounded batches. */
export async function playRecommendationPool(candidates, options = {}) {
  const { selected, context, firstPlayable = false, isCurrent = () => true, onProviderFailure, onProgress, onStarted, onReserved, startFromProvider, returnAfterStart = false, store = usePlayerStore } = options
  let { resolve } = options
  const pool = uniqueSongs(candidates)
  let index = selected ? pool.findIndex(track => songKey(track) === songKey(selected)) : 0
  if (!isCurrent()) return null
  if (index < 0 || !pool.length) return false
  // Supersede an older lookup immediately, including before either lookup has
  // started audio. Explicit playTrack/playQueue calls also advance this token.
  let version = (store.getState().playbackGeneration || 0) + 1
  store.setState({ playbackGeneration: version, recommendationLoading: version })
  onReserved?.(version)
  const current = () => isCurrent() && store.getState().playbackGeneration === version
  let backgroundResolutionOwnsLoading = false
  const clearLoading = () => {
    if (store.getState().recommendationLoading === version) store.setState({ recommendationLoading: 0 })
  }
  try {
    if (!resolve) {
      const sources = await playbackSources()
      resolve = (rows, options) => resolveRecommendationTracks(rows, undefined, { ...options, sources })
    }
    const skipUnavailable = firstPlayable || ['discovery', 'mix'].includes(context?.type)
    const failed = new Set()
    let first
    const start = index
    const attempts = selected && skipUnavailable ? pool.length : pool.length - start
    for (let attempt = 0; attempt < attempts && current(); attempt++) {
      index = (start + attempt) % pool.length
      let rows
      let verificationPrompted = false
      const retryCandidate = provider => {
        // Another play action can supersede this candidate while the prompt is open.
        if (!current()) return undefined
        return playRecommendationPool(candidates, {
          ...options, resolve, selected: pool[index], startFromProvider: provider, returnAfterStart: true,
        })
      }
      try {
        rows = await resolve([pool[index]], {
          isCurrent: current, prepareStreams: true, onProviderFailure, onProgress,
          ...(startFromProvider ? { startFromProvider } : {}),
          onAddonVerificationRequired: error => {
            verificationPrompted = true
            if (current()) requestAddonVerification(error, () => retryCandidate(error.provider))
          },
        })
      } catch (error) {
        if (isAddonVerificationRequiredError(error)) {
          if (current() && !verificationPrompted) requestAddonVerification(error, () => retryCandidate(error.provider))
          return null
        }
        rows = []
      }
      first = rows[0]
      if (first || !skipUnavailable) break
      failed.add(songKey(pool[index]))
      onProgress?.(`“${pool[index].title}” is unavailable. Trying the next song…`)
    }
    if (!current()) return null
    if (!first) return false
    store.getState().playQueue([first], 0, context)
    version = store.getState().playbackGeneration
    store.setState({ recommendationLoading: version })
    onStarted?.(first)
    const rest = [...pool.slice(index + 1), ...(firstPlayable ? [] : pool.slice(0, index))].filter(track => !failed.has(songKey(track)))
    const order = pool.map(songKey)
    const resolveRemaining = async from => {
      for (let at = from; at < rest.length && current(); at += 4) {
        onProgress?.(`Loading remaining tracks… ${Math.min(at + 4, rest.length)} / ${rest.length}`)
        // Future songs are prepared when they actually play. Known preview results
        // are still rejected here, and runtime preparation handles hidden previews.
        let rows
        let verificationPrompted = false
        const retryBatch = () => resolveRemaining(at)
        try {
          rows = await resolve(rest.slice(at, at + 4), {
            isCurrent: current, prepareStreams: false, onProviderFailure, onProgress,
            onAddonVerificationRequired: error => {
              verificationPrompted = true
              if (current()) requestAddonVerification(error, retryBatch)
            },
          })
        } catch (error) {
          if (isAddonVerificationRequiredError(error)) {
            if (current() && !verificationPrompted) requestAddonVerification(error, retryBatch)
            return false
          }
          continue
        }
        if (current() && rows.length) store.getState().extendRecommendationQueue(rows, order, version)
      }
      return current()
    }
    if (returnAfterStart) {
      // Resolving the rest of Discovery is background work; don't keep the
      // verification dialog blocking controls after the selected song starts.
      backgroundResolutionOwnsLoading = true
      void resolveRemaining(0).catch(() => {}).finally(clearLoading)
      return true
    }
    const remainingResolved = await resolveRemaining(0)
    return remainingResolved === false ? null : true
  } finally {
    if (!backgroundResolutionOwnsLoading) clearLoading()
  }
}

const failedQueues = new WeakMap()

/** After exhausting a song's providers, advance within the same recommendation queue. */
export async function skipUnavailableRecommendation(failedTrack, store = usePlayerStore) {
  const initial = store.getState()
  if (initial.currentTrack !== failedTrack || !['discovery', 'mix', 'flow', 'global'].includes(initial.playbackContext?.type)) return false
  const generation = initial.playbackGeneration
  let failures = failedQueues.get(store)
  if (failures?.generation !== generation) {
    failures = { generation, songs: new Set() }
    failedQueues.set(store, failures)
  }
  failures.songs.add(songKey(failedTrack))
  while (true) {
    const state = store.getState()
    if (state.playbackGeneration !== generation || state.currentTrack !== failedTrack) return false
    const list = state.shuffle ? state.shuffleQueue : state.queue
    const index = state.shuffle ? state.shuffleIndex : state.queueIndex
    const upcoming = [...list.slice(index + 1), ...(state.repeat === 'all' ? list.slice(0, index) : [])]
    const next = upcoming.find(track => !failures.songs.has(songKey(track)))
    if (next) {
      store.setState({ currentTrack: next, queueIndex: state.queue.findIndex(track => track.id === next.id), shuffleIndex: state.shuffle ? list.indexOf(next) : state.shuffleIndex, isPlaying: true, progress: 0, duration: 0, playHistory: [...state.playHistory, next.id], futureHistory: [] })
      return true
    }
    if (state.recommendationLoading !== generation) return false
    // The next batch may still be resolving. Wait for it rather than treating
    // the temporary one-song queue as the end of the Discovery list.
    store.getState().setIsPlaying(false)
    await new Promise(resolve => {
      const unsubscribe = store.subscribe(nextState => {
        if (nextState.playbackGeneration !== generation || nextState.currentTrack !== failedTrack || nextState.queue !== state.queue || nextState.recommendationLoading !== generation) { unsubscribe(); resolve() }
      })
    })
  }
}
