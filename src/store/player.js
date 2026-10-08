import { create } from 'zustand'
import { packQueue, unpackQueue, QUEUE_KEYS } from '../queueStorage.js'
import { isPlayable } from '../onlineTracks.js'
import { songKey } from '../recommendations.js'

// Only used by toggleMiniPlayer's setWindowSize/setAlwaysOnTop fallback path
// below (when window.electron.setMiniMode isn't available), to remember the
// window size to restore when leaving mini mode. A plain module-level
// variable rather than component state, since the resize now happens here
// in the store -- not in a component effect -- and needs to persist across
// the enter/exit pair regardless of what's mounted at the time.
let miniModeFallbackPrevSize = null

// Serializes toggleMiniPlayer calls (below) so a fast double-click can't let
// two overlapping calls both read showMiniPlayer via the same stale get()
// before either one's IPC round-trip resolves -- each call now only reads
// `next` after any prior toggle has actually finished.
let miniModeToggleChain = Promise.resolve()

// Shared by setExclusiveSidePanels (the user's Settings toggle) and
// hydrateExclusiveSidePanels (the backend value at boot): the panel
// visibility to apply when switching Side Panels mode to `value`. Carries
// over whichever panel is currently open instead of just dropping it.
function sidePanelModeTransition(s, value) {
  // Switching to merged mode: fold whichever standalone panel is visible
  // into the single panel instead of just dropping it. Queue and Lyrics can
  // both be open at once in independent mode (they're fully separate panels
  // there); the merged panel only has one slot, so prefer Queue if both
  // happen to be open.
  if (value && (s.showQueue || s.showLyricsPanel)) {
    return {
      exclusiveSidePanels: value,
      showQueue: false,
      showLyricsPanel: false,
      showRightSidebar: true,
      sidePanelView: s.showQueue ? 'queue' : 'lyrics',
    }
  }
  // Switching to independent mode: reopen a visible merged Queue/Lyrics
  // overlay as its own standalone panel instead of just dropping it.
  if (!value && s.showRightSidebar && (s.sidePanelView === 'queue' || s.sidePanelView === 'lyrics')) {
    return {
      exclusiveSidePanels: value,
      showQueue: s.sidePanelView === 'queue',
      showLyricsPanel: s.sidePanelView === 'lyrics',
      sidePanelView: 'info',
    }
  }
  return {
    exclusiveSidePanels: value,
    // Any other stale 'queue'/'lyrics' reference can't be shown as a closed
    // panel in either mode -- fall back to info so neither renderer starts
    // on a view it doesn't own.
    sidePanelView: (s.sidePanelView === 'queue' || s.sidePanelView === 'lyrics') ? 'info' : s.sidePanelView,
  }
}

// Ghost tracks (no file) stay out of the queue, except online songs, which
// are streamed.
function sanitizeTrackList(tracks) {
  return Array.isArray(tracks) ? tracks.filter(track => track?.id && isPlayable(track)) : []
}

function sanitizeSingleTrack(track) {
  return track?.id && isPlayable(track) ? track : null
}

// Settings > Appearance > Layout > Side Panels. Defaults to merged/exclusive
// (only one of the Now Playing sidebar / Queue open at a time) unless the
// user has explicitly opted into the old independent (both-open) behavior.
// Only used to seed initial store state -- once loaded, components read the
// reactive `exclusiveSidePanels` field instead, so a live setting change
// (no reload) is reflected everywhere immediately.
function readExclusiveSidePanelsSetting() {
  try {
    return localStorage.getItem('lokal-exclusive-panels') !== '0'
  } catch {
    return true
  }
}

// Settings > Appearance > Layout > "Open the side panel on play". On unless
// switched off; read synchronously here (the backend copy is synced by
// Settings).
function readAutoOpenSidePanelSetting() {
  try {
    return localStorage.getItem('lokal-auto-open-side-panel') !== '0'
  } catch {
    return true
  }
}

function readOutputDevice() {
  try { return localStorage.getItem('lokal-output-device') || 'default' } catch { return 'default' }
}

// Starting playback yourself (a track, album, playlist, mix...) opens the
// Now Playing panel when it's closed, as Spotify does. Only playTrack and
// playQueue call this -- the queue moving on, resuming, skipping don't --
// so closing the panel while music plays keeps it closed until you start
// something else. Not in the mini player, which has no room for it.
function sidePanelOnPlay(s) {
  if (!s.autoOpenSidePanel || s.showMiniPlayer || s.showRightSidebar) return {}
  return s.exclusiveSidePanels ? { showRightSidebar: true, sidePanelView: 'info' } : { showRightSidebar: true }
}

function loadQueue() {
  try {
    const data = localStorage.getItem('lokal-queue')
    if (!data) return null
    const parsed = unpackQueue(JSON.parse(data))
    if (!parsed) return null

    if (Array.isArray(parsed.queue)) {
      const queue = sanitizeTrackList(parsed.queue)
      const shuffleQueue = sanitizeTrackList(parsed.shuffleQueue)
      const originalQueue = sanitizeTrackList(parsed.originalQueue)
      const currentTrack = sanitizeSingleTrack(parsed.currentTrack)
      return {
        ...parsed,
        queue,
        shuffleQueue,
        originalQueue,
        currentTrack,
        playbackContext: parsed.playbackContext && typeof parsed.playbackContext === 'object'
          ? parsed.playbackContext
          : null,
        queueIndex: currentTrack ? Math.max(queue.findIndex(track => track.id === currentTrack.id), 0) : -1,
        shuffleIndex: currentTrack ? Math.max(shuffleQueue.findIndex(track => track.id === currentTrack.id), 0) : -1,
        isPlaying: false,
        progress: 0,
        duration: 0,
        audioRef: null,
        cfAudioRef: null,
      }
    }
  } catch (e) {
    console.error('Failed to load queue from localStorage', e)
  }
  return null
}

function loadUser() {
  try { return JSON.parse(localStorage.getItem('lokal-user') || 'null') } catch { return null }
}


function shuffleArray(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

const savedQueueState = loadQueue()

// A track's details changed (edited, new artwork...): let anything that
// remembers per-track lookups (moving covers, cover colours) look again.
function announceTrackUpdates(tracks) {
  const ids = (Array.isArray(tracks) ? tracks : []).map(t => t?.id).filter(Boolean)
  if (!ids.length || typeof window === 'undefined') return
  try { window.dispatchEvent(new CustomEvent('lokal:track-updated', { detail: { ids } })) } catch {}
}

export const usePlayerStore = create((set, get) => ({
  queue: [], queueIndex: -1, currentTrack: null,
  playbackContext: null,
  isPlaying: false, isBuffering: false, progress: 0, duration: 0,
  volume: parseFloat(localStorage.getItem('lokal-volume') || '0.8'),
  shuffle: false, repeat: 'none',
  showLyrics: false, showLyricsFullscreen: false,
  showRightSidebar: false, showFullscreen: false, showQueue: false, showLyricsPanel: false,
  // Which content the right-hand panel shows. Only meaningful in merged
  // mode -- independent mode's Queue lives in its own separate panel and
  // never touches this.
  sidePanelView: 'info',
  // Settings > Appearance > Layout > Side Panels. Store state (not just a
  // localStorage read inside actions) so components can react live when
  // the setting changes, without needing a reload. Initialized from
  // localStorage so the choice persists across sessions.
  exclusiveSidePanels: readExclusiveSidePanelsSetting(),
  autoOpenSidePanel: readAutoOpenSidePanelSetting(),
  // True once the switch was clicked this session, so a settings load that
  // resolves later (even from a Settings page since closed) can't undo it.
  autoOpenSidePanelUserSet: false,
  // True once the user has explicitly picked a Side Panels mode this
  // session (via the Settings toggle). Lets hydrateExclusiveSidePanels
  // (the backend-persisted value, fetched async at app boot and again on
  // Settings mount) tell a fresher live choice apart from the stale
  // localStorage-seeded default, so a slow response can never clobber a
  // selection the user already made while it was in flight.
  exclusiveSidePanelsUserSet: false,
  audioRef: null, cfAudioRef: null, crossfadeSeconds: 0, _fetchingRelated: false,
  activeAudioElement: 'primary',
  outputDeviceId: readOutputDevice(),

  originalQueue: [], 
  shuffleQueue: [], 
  shuffleIndex: -1, 
  playHistory: [], 
  futureHistory: [], 
  wasShuffled: false, 

  ...(savedQueueState || {}),
  playbackGeneration: 0,

  setAudioRef: (ref) => set({ audioRef: ref }),
  setCfAudioRef: (ref) => set({ cfAudioRef: ref }),
  setActiveAudioElement: (el) => set({ activeAudioElement: el }),
  setOutputDevice: (id) => {
    const value = String(id || 'default')
    try { localStorage.setItem('lokal-output-device', value) } catch {}
    set({ outputDeviceId: value })
  },
  setFetchingRelated: (v) => set({ _fetchingRelated: v }),
  appendRelated: (tracks) => {
    const { queue, playbackContext } = get()
    if (playbackContext?.type === 'discovery' || playbackContext?.type === 'mix') return
    const ids = new Set(queue.map(t => t.id))
    const fresh = sanitizeTrackList(tracks).filter(t => !ids.has(t.id))
    if (fresh.length) set({ queue: [...queue, ...fresh] })
  },

  initShuffleQueue: (tracks, currentIndex) => {
    const sanitizedTracks = sanitizeTrackList(tracks)
    const safeIndex = Math.min(Math.max(currentIndex, 0), Math.max(sanitizedTracks.length - 1, 0))
    const currentTrack = sanitizedTracks[safeIndex]
    const otherTracks = sanitizedTracks.filter((_, i) => i !== safeIndex)
    const shuffled = shuffleArray(otherTracks)
    const shuffleQueue = currentTrack ? [currentTrack, ...shuffled] : shuffled
    const shuffleIndex = 0
    
    set({ 
      shuffleQueue, 
      shuffleIndex, 
      originalQueue: tracks,
      wasShuffled: true,
      playHistory: currentTrack ? [currentTrack.id] : [],
      futureHistory: []
    })
  },

  disableShuffle: () => {
    const { originalQueue, currentTrack, playHistory } = get()
    if (!originalQueue.length || !currentTrack) {
      set({ shuffle: false, shuffleQueue: [], shuffleIndex: -1, wasShuffled: false })
      return
    }
    
    const newIndex = originalQueue.findIndex(t => t.id === currentTrack.id)
    set({ 
      shuffle: false, 
      queue: originalQueue,
      queueIndex: newIndex >= 0 ? newIndex : 0,
      shuffleQueue: [], 
      shuffleIndex: -1,
      wasShuffled: false 
    })
  },

  enableShuffle: () => {
    const { queue, currentTrack, queueIndex } = get()
    if (!queue.length) {
      set({ shuffle: true })
      return
    }
    
    const currentIndex = queueIndex >= 0 ? queueIndex : 0
    get().initShuffleQueue(queue, currentIndex)
    set({ shuffle: true })
  },

  toggleShuffle: () => {
    const { shuffle, enableShuffle, disableShuffle } = get()
    if (shuffle) {
      disableShuffle()
    } else {
      enableShuffle()
    }
  },

  setPlaybackContext: (context) => set({ playbackContext: context || null }),

  // A fallback changes the stream for the same queue entry, not the queue's
  // order, shuffle state, or playback context.
  replaceCurrentTrack: (oldId, track) => set(state => {
    if (state.currentTrack?.id !== oldId || !sanitizeSingleTrack(track)) return {}
    const replace = list => list.map(item => item.id === oldId ? track : item)
    const replaceId = list => list.map(id => id === oldId ? track.id : id)
    return {
      currentTrack: track,
      queue: replace(state.queue),
      originalQueue: replace(state.originalQueue),
      shuffleQueue: replace(state.shuffleQueue),
      playHistory: replaceId(state.playHistory),
      futureHistory: replaceId(state.futureHistory),
      progress: 0,
      duration: 0,
    }
  }),

  extendRecommendationQueue: (tracks, order, generation) => set(state => {
    if (state.playbackGeneration !== generation) return {}
    const known = new Set(state.queue.map(songKey))
    const fresh = sanitizeTrackList(tracks).filter(track => {
      const key = songKey(track)
      if (known.has(key)) return false
      known.add(key)
      return true
    })
    if (!fresh.length) return {}
    const ranks = new Map(order.map((key, index) => [key, index]))
    const queue = [...state.queue]
    for (const track of fresh) {
      const rank = ranks.get(songKey(track))
      const before = queue.findIndex(item => ranks.get(songKey(item)) > rank)
      queue.splice(before < 0 ? queue.length : before, 0, track)
    }
    const shuffledKeys = new Set(state.shuffleQueue.map(songKey))
    return {
      queue, queueIndex: queue.findIndex(track => track.id === state.currentTrack?.id),
      originalQueue: queue,
      shuffleQueue: state.shuffle ? [...state.shuffleQueue, ...shuffleArray(fresh.filter(track => !shuffledKeys.has(songKey(track))))] : state.shuffleQueue,
    }
  }),

  playTrack: (track, queue = null, context = null) => {
    const playableTrack = sanitizeSingleTrack(track)
    if (!playableTrack) return
    const q = sanitizeTrackList(queue || get().queue)
    if (!q.length) return
    const idx = Math.max(q.findIndex(t => t.id === playableTrack.id), 0)
    
    if (get().shuffle) {
      get().initShuffleQueue(q, idx)
    }
    
    set(s => ({ 
      currentTrack: playableTrack, 
      playbackGeneration: (s.playbackGeneration || 0) + 1,
      queue: q, 
      queueIndex: idx, 
      isPlaying: true, 
      playbackContext: context || null,
      playHistory: [playableTrack.id],
      futureHistory: [],
      ...sidePanelOnPlay(s),
    }))
  },

  playQueue: (tracks, startIndex = 0, context = null) => {
    const sanitizedTracks = sanitizeTrackList(tracks)
    if (!sanitizedTracks.length) return
    
    const safeIndex = Math.min(Math.max(startIndex, 0), sanitizedTracks.length - 1)
    const startTrack = sanitizedTracks[safeIndex]
    
    if (get().shuffle) {
      get().initShuffleQueue(sanitizedTracks, safeIndex)
    }
    
    set(s => ({ 
      queue: sanitizedTracks, 
      playbackGeneration: (s.playbackGeneration || 0) + 1,
      queueIndex: safeIndex, 
      currentTrack: startTrack, 
      isPlaying: true,
      playbackContext: context || null,
      playHistory: startTrack ? [startTrack.id] : [],
      futureHistory: [],
      ...sidePanelOnPlay(s),
    }))
  },

  togglePlay: () => {
    const { audioRef, cfAudioRef, activeAudioElement, isPlaying } = get()
    const activeRef = activeAudioElement === 'primary' ? audioRef : cfAudioRef
    if (!activeRef?.current) return
    isPlaying ? activeRef.current.pause() : activeRef.current.play()
    set({ isPlaying: !isPlaying })
  },

  next: () => {
    const { shuffle, shuffleQueue, shuffleIndex, queue, queueIndex, repeat, futureHistory, playHistory } = get()
    
    if (shuffle && shuffleQueue.length > 0) {
      let nextIdx = shuffleIndex + 1
      
      if (nextIdx < shuffleQueue.length) {
        const nextTrack = shuffleQueue[nextIdx]
        const newHistory = [...playHistory, nextTrack.id]
        set({ 
          shuffleIndex: nextIdx,
          currentTrack: nextTrack,
          queueIndex: queue.findIndex(t => t.id === nextTrack.id),
          isPlaying: true,
          playHistory: newHistory,
          futureHistory: []
        })
      } else if (repeat === 'all') {
        const otherTracks = shuffleQueue.filter((_, i) => i !== shuffleIndex)
        const reshuffled = shuffleArray(otherTracks)
        const current = shuffleQueue[shuffleIndex]
        const newShuffleQueue = [current, ...reshuffled]
        const nextTrack = newShuffleQueue[0]
        set({
          shuffleQueue: newShuffleQueue,
          shuffleIndex: 0,
          currentTrack: nextTrack,
          queueIndex: queue.findIndex(t => t.id === nextTrack.id),
          isPlaying: true,
          playHistory: [nextTrack.id],
          futureHistory: []
        })
      }
      return
    }
    
    
    if (!queue.length) return
    let idx
    if (queueIndex < queue.length - 1) idx = queueIndex + 1
    else if (repeat === 'all') idx = 0
    else return
    
    const nextTrack = queue[idx]
    const newHistory = [...playHistory, nextTrack.id]
    set({ 
      queueIndex: idx, 
      currentTrack: nextTrack, 
      isPlaying: true,
      playHistory: newHistory,
      futureHistory: []
    })
  },

  autoNext: () => {
    const { shuffle, shuffleQueue, shuffleIndex, queue, queueIndex, repeat, playHistory } = get()
    
    if (shuffle && shuffleQueue.length > 0) {
      let nextIdx = shuffleIndex + 1
      
      if (nextIdx < shuffleQueue.length) {
        const nextTrack = shuffleQueue[nextIdx]
        const newHistory = [...playHistory, nextTrack.id]
        set({ 
          shuffleIndex: nextIdx,
          currentTrack: nextTrack,
          queueIndex: queue.findIndex(t => t.id === nextTrack.id),
          isPlaying: true,
          playHistory: newHistory,
          futureHistory: []
        })
      } else if (repeat === 'all') {
        const current = shuffleQueue[shuffleIndex]
        const otherTracks = shuffleQueue.filter((_, i) => i !== shuffleIndex)
        const reshuffled = shuffleArray(otherTracks)
        const newShuffleQueue = [current, ...reshuffled]
        const nextTrack = newShuffleQueue[0]
        set({
          shuffleQueue: newShuffleQueue,
          shuffleIndex: 0,
          currentTrack: nextTrack,
          queueIndex: queue.findIndex(t => t.id === nextTrack.id),
          isPlaying: true,
          playHistory: [nextTrack.id],
          futureHistory: []
        })
      }
      return
    }
    
    if (!queue.length) return
    let idx
    if (queueIndex < queue.length - 1) idx = queueIndex + 1
    else if (repeat === 'all') idx = 0
    else return
    
    const nextTrack = queue[idx]
    const newHistory = [...playHistory, nextTrack.id]
    set({ 
      queueIndex: idx, 
      currentTrack: nextTrack, 
      isPlaying: true,
      playHistory: newHistory,
      futureHistory: []
    })
  },

  prev: () => {
    const {
      shuffle, shuffleQueue, shuffleIndex, queue, queueIndex,
      progress, audioRef, cfAudioRef, activeAudioElement, playHistory, futureHistory
    } = get()
    const activeRef = activeAudioElement === 'primary' ? audioRef : cfAudioRef
    
    if (progress > 3 && activeRef?.current) {
      activeRef.current.currentTime = 0
      return
    }
    
    if (playHistory.length > 1) {
      const newHistory = [...playHistory]
      newHistory.pop() 
      const prevTrackId = newHistory[newHistory.length - 1]
      
      let prevTrack = null
      let prevIndex = -1
      
      if (shuffle && shuffleQueue.length > 0) {
        prevTrack = shuffleQueue.find(t => t.id === prevTrackId)
        prevIndex = shuffleQueue.findIndex(t => t.id === prevTrackId)
      }
      
      if (!prevTrack) {
        prevTrack = queue.find(t => t.id === prevTrackId)
        prevIndex = queue.findIndex(t => t.id === prevTrackId)
      }
      
      if (prevTrack) {
        const currentId = shuffle && shuffleQueue[shuffleIndex]?.id 
          ? shuffleQueue[shuffleIndex].id 
          : queue[queueIndex]?.id
        
        const newFuture = [...futureHistory, currentId].slice(-20) 
        
        if (shuffle) {
          set({ 
            shuffleIndex: prevIndex,
            currentTrack: prevTrack,
            queueIndex: queue.findIndex(t => t.id === prevTrack.id),
            isPlaying: true,
            playHistory: newHistory,
            futureHistory: newFuture
          })
        } else {
          set({ 
            queueIndex: prevIndex, 
            currentTrack: prevTrack, 
            isPlaying: true,
            playHistory: newHistory,
            futureHistory: newFuture
          })
        }
        return
      }
    }
    if (queueIndex > 0) {
      const prevTrack = queue[queueIndex - 1]
      const newHistory = [...playHistory, prevTrack.id]
      set({ queueIndex: queueIndex - 1, currentTrack: prevTrack, isPlaying: true, playHistory: newHistory })
    }
  },

  skipAhead: () => {
    const { shuffle, shuffleQueue, shuffleIndex, queue, queueIndex, playHistory, futureHistory, repeat } = get()
    
    const playedIds = new Set([...playHistory, ...futureHistory])
    
    let candidates = []
    
    if (shuffle && shuffleQueue.length > 0) {
      candidates = shuffleQueue.filter((t, i) => i !== shuffleIndex && !playedIds.has(t.id))
      
      if (candidates.length === 0 && repeat === 'all') {
        const current = shuffleQueue[shuffleIndex]
        const remaining = shuffleQueue.filter((t, i) => i !== shuffleIndex)
        const reshuffled = shuffleArray(remaining)
        candidates = reshuffled
      }
    } else {
      candidates = queue.filter((t, i) => i !== queueIndex && !playedIds.has(t.id))
      
      if (candidates.length === 0 && repeat === 'all') {
        candidates = queue.filter((t, i) => i !== queueIndex)
      }
    }
    
    if (candidates.length === 0) return
    
    const randomTrack = candidates[Math.floor(Math.random() * candidates.length)]
    
    const currentId = shuffle && shuffleQueue[shuffleIndex]?.id 
      ? shuffleQueue[shuffleIndex].id 
      : queue[queueIndex]?.id
    
    const newFuture = [...futureHistory, currentId].slice(-20)
    const newHistory = [...playHistory, randomTrack.id]
    
    if (shuffle) {
      const newShuffleIndex = shuffleQueue.findIndex(t => t.id === randomTrack.id)
      set({
        shuffleIndex: newShuffleIndex >= 0 ? newShuffleIndex : shuffleIndex,
        currentTrack: randomTrack,
        queueIndex: queue.findIndex(t => t.id === randomTrack.id),
        isPlaying: true,
        playHistory: newHistory,
        futureHistory: newFuture
      })
    } else {
      const newQueueIndex = queue.findIndex(t => t.id === randomTrack.id)
      set({
        queueIndex: newQueueIndex >= 0 ? newQueueIndex : queueIndex,
        currentTrack: randomTrack,
        isPlaying: true,
        playHistory: newHistory,
        futureHistory: newFuture
      })
    }
  },

  playNext: (track) => {
    const playableTrack = sanitizeSingleTrack(track)
    if (!playableTrack) return
    const { shuffle, shuffleQueue, shuffleIndex, queue, queueIndex } = get()
    
    if (shuffle && shuffleQueue.length > 0) {
      const newShuffleQueue = [...shuffleQueue]
      newShuffleQueue.splice(shuffleIndex + 1, 0, playableTrack)
      set({ shuffleQueue: newShuffleQueue })
    } else {
      const newQueue = [...queue]
      newQueue.splice(queueIndex + 1, 0, playableTrack)
      set({ queue: newQueue })
    }
  },

  // The song playing becomes the start of a new queue (a radio started from
  // it), without restarting it: only the queue around it changes.
  continueAsQueue: (tracks, context = null) => {
    const list = sanitizeTrackList(tracks)
    const { currentTrack, shuffle } = get()
    if (!list.length || !currentTrack || list[0].id !== currentTrack.id) return false
    if (shuffle) get().initShuffleQueue(list, 0)
    set({ queue: list, queueIndex: 0, playbackContext: context, futureHistory: [] })
    return true
  },

  // More songs at the end of the queue that's playing (a radio still being
  // built), only while that queue is still the one playing: its context's id
  // has to match. Songs already in it aren't added twice.
  extendQueue: (tracks, context) => {
    const state = get()
    if (!context?.id || state.playbackContext?.id !== context.id) return
    const known = new Set(state.queue.map(track => track.id))
    const extra = sanitizeTrackList(tracks).filter(track => !known.has(track.id))
    if (!extra.length) return
    set(s => ({
      queue: [...s.queue, ...extra],
      ...(s.shuffle && s.shuffleQueue.length ? { shuffleQueue: [...s.shuffleQueue, ...shuffleArray(extra)] } : {}),
      ...(s.originalQueue.length ? { originalQueue: [...s.originalQueue, ...extra] } : {}),
    }))
  },

  addToQueue: (track) => {
    const playableTrack = sanitizeSingleTrack(track)
    if (!playableTrack) return
    const { shuffle, shuffleQueue, queue } = get()
    
    if (shuffle && shuffleQueue.length > 0) {
      set({ shuffleQueue: [...shuffleQueue, playableTrack] })
    } else {
      set({ queue: [...queue, playableTrack] })
    }
  },

  reorderQueue: (fromIndex, toIndex) => {
    const { shuffle, queue, queueIndex } = get()
    if (shuffle) return
    
    const newQueue = [...queue]
    const [removed] = newQueue.splice(fromIndex, 1)
    newQueue.splice(toIndex, 0, removed)
    
    let newCurrentIndex = queueIndex
    if (fromIndex === queueIndex) {
      newCurrentIndex = toIndex
    } else if (fromIndex < queueIndex && toIndex >= queueIndex) {
      newCurrentIndex--
    } else if (fromIndex > queueIndex && toIndex <= queueIndex) {
      newCurrentIndex++
    }
    
    set({ queue: newQueue, queueIndex: newCurrentIndex })
  },

  removeFromQueue: (trackId) => {
    const { shuffle, shuffleQueue, shuffleIndex, queue, queueIndex, currentTrack } = get()
    
    if (shuffle && shuffleQueue.length > 0) {
      const idx = shuffleQueue.findIndex(t => t.id === trackId)
      if (idx === shuffleIndex) return 
      const newShuffleQueue = shuffleQueue.filter(t => t.id !== trackId)
      const newShuffleIndex = idx < shuffleIndex ? shuffleIndex - 1 : shuffleIndex
      set({ shuffleQueue: newShuffleQueue, shuffleIndex: newShuffleIndex })
    } else {
      const idx = queue.findIndex(t => t.id === trackId)
      if (idx === queueIndex) return 
      const newQueue = queue.filter(t => t.id !== trackId)
      const newQueueIndex = idx < queueIndex ? queueIndex - 1 : queueIndex
      set({ queue: newQueue, queueIndex: newQueueIndex })
    }
  },

  setProgress: (v) => set({ progress: v }),
  setIsBuffering: (v) => set({ isBuffering: !!v }),
  setProgressWithAudioUpdate: (v) => {
    const { audioRef, cfAudioRef, activeAudioElement } = get()
    const activeRef = activeAudioElement === 'primary' ? audioRef : cfAudioRef
    if (activeRef?.current) {
      activeRef.current.currentTime = v
    }
    set({ progress: v })
  },
  setDuration: (v) => set({ duration: v }),
  setVolume: (v) => { localStorage.setItem('lokal-volume', String(v)); set({ volume: v }) },
  toggleRepeat: () => set(s => ({ repeat: s.repeat === 'none' ? 'all' : s.repeat === 'all' ? 'one' : 'none' })),
  // Direct setter, unlike toggleRepeat above: needed for the Windows SMTC
  // bridge (electron/ipc/smtc.js), which reports the OS flyout's repeat
  // button was set to an exact target mode ('none'|'all'|'one'), not "cycle
  // to the next one".
  setRepeat: (mode) => set({ repeat: mode === 'all' || mode === 'one' ? mode : 'none' }),
  toggleLyrics: () => set(s => ({ showLyrics: !s.showLyrics })),
  toggleLyricsFullscreen: () => set(s => ({ showLyricsFullscreen: !s.showLyricsFullscreen })),
  // Go straight from one full-screen view to the other. Full-screen lyrics
  // opens over the player (closing it lands back on the player); the player
  // is reached from lyrics by closing lyrics and opening the player under it,
  // so this works whichever of the two was opened first.
  switchFullscreenView: (view) => set(view === 'lyrics'
    ? { showLyricsFullscreen: true }
    : { showFullscreen: true, showLyricsFullscreen: false }),
  // Opens/closes the right-hand panel itself. In merged mode, reopening
  // always resets to the base "info" view -- the panel's info/lyrics
  // content is the persistent base that Queue slides up over, per Spotify's
  // own pattern, so reopening should land back on that base rather than
  // wherever it happened to be showing when last closed.
  toggleRightSidebar: () => set(s => {
    if (!s.exclusiveSidePanels) {
      // Independent mode: exactly the original, fully separate behavior --
      // no interaction with the Queue panel at all.
      return { showRightSidebar: !s.showRightSidebar }
    }
    if (!s.showRightSidebar) {
      return { showRightSidebar: true, sidePanelView: 'info' }
    }
    // Panel's already open, whatever it's currently showing (info, Queue,
    // or Lyrics). This is the sidebar's own collapse button (the chevron in
    // its header, which stays visible above the Queue/Lyrics overlays), so
    // it always collapses the whole panel in one click rather than first
    // sliding the Queue/Lyrics overlay back down to info and only closing
    // on a second click -- reopening already resets to 'info' above, so
    // there's nothing left to reset here on the way out.
    return { showRightSidebar: false }
  }),
  toggleFullscreen: () => set(s => {
    const next = !s.showFullscreen
    if (!next && typeof window !== 'undefined' && window.electron?.refreshHitRegions) {
      // Closing fullscreen with a side panel (Queue/Lyrics) still open
      // unmounts a wide chunk of DOM at the same moment the whole overlay
      // fades out -- on Windows that's been enough to leave the frameless
      // window's native hit-test map stale, so clicks land offset from the
      // cursor until the app is restarted. Nudge it back in sync once the
      // overlay's own exit fade (FullscreenPlayer, 300ms) has settled.
      // See electron/main.js's window:refreshHitRegions handler.
      setTimeout(() => window.electron.refreshHitRegions(), 350)
    }
    return { showFullscreen: next }
  }),
  // Closes the *standalone* Queue panel (independent mode only -- that's
  // the only mode where it's ever mounted as its own sibling, so this
  // never needs to know about the sidebar).
  toggleQueue: () => set(s => ({ showQueue: !s.showQueue })),
  // Mode-aware Queue button. Independent mode: behaves exactly like the
  // original, unmodified toggleQueue. Merged mode: opens the single panel
  // straight to Queue if it's closed (the separate "Now Playing" button
  // handles opening to info), slides Queue up over whatever's showing if
  // the panel's already open, or slides back down to info if Queue is
  // already what's showing.
  toggleQueueButton: () => set(s => {
    if (!s.exclusiveSidePanels) {
      return { showQueue: !s.showQueue }
    }
    if (!s.showRightSidebar) {
      return { showRightSidebar: true, sidePanelView: 'queue' }
    }
    return { sidePanelView: s.sidePanelView === 'queue' ? 'info' : 'queue' }
  }),
  // Closes the *standalone* Lyrics panel (independent mode only -- mirrors
  // toggleQueue exactly, for the same reason: that's the only mode where
  // it's ever mounted as its own sibling).
  toggleLyricsPanel: () => set(s => ({ showLyricsPanel: !s.showLyricsPanel })),
  // Mode-aware Lyrics button (the player bar's mic icon). Previously jumped
  // straight to the full-screen lyrics overlay (toggleLyricsFullscreen,
  // which still exists -- it's what the "Expand Lyrics" button inside this
  // same view opens); now mirrors toggleQueueButton instead. Independent
  // mode: its own standalone panel. Merged mode: opens the single panel
  // straight to the existing 'lyrics' tab if closed, switches to it if the
  // panel's already open showing something else, or switches back to
  // 'info' if Lyrics is already what's showing.
  toggleLyricsButton: () => set(s => {
    if (!s.exclusiveSidePanels) {
      return { showLyricsPanel: !s.showLyricsPanel }
    }
    if (!s.showRightSidebar) {
      return { showRightSidebar: true, sidePanelView: 'lyrics' }
    }
    return { sidePanelView: s.sidePanelView === 'lyrics' ? 'info' : 'lyrics' }
  }),
  setSidePanelView: (view) => set({ sidePanelView: view }),
  setAutoOpenSidePanel: (value) => {
    try { localStorage.setItem('lokal-auto-open-side-panel', value ? '1' : '0') } catch {}
    set({ autoOpenSidePanel: !!value, autoOpenSidePanelUserSet: true })
  },
  // The backend's copy, applied unless the user already chose this session.
  hydrateAutoOpenSidePanel: (value) => {
    if (get().autoOpenSidePanelUserSet) return
    try { localStorage.setItem('lokal-auto-open-side-panel', value ? '1' : '0') } catch {}
    set({ autoOpenSidePanel: !!value })
  },
  // The user's own explicit mode choice (the Settings toggle). Carries
  // over whichever panel is currently open instead of just dropping it:
  // switching to merged mode folds a visible standalone Queue panel into
  // the sidebar's Queue view; switching to independent mode reopens a
  // visible merged Queue overlay as the standalone panel. Either way, a
  // panel that's about to become unrenderable in the new mode never gets
  // left stuck open in the old one.
  setExclusiveSidePanels: (value) => {
    try { localStorage.setItem('lokal-exclusive-panels', value ? '1' : '0') } catch {}
    set(s => ({
      ...sidePanelModeTransition(s, value),
      exclusiveSidePanelsUserSet: true,
    }))
  },
  // Syncs the backend-persisted Side Panels setting in (called once at app
  // boot, and again when Settings mounts). A no-op once the user has made
  // their own live choice this session -- see exclusiveSidePanelsUserSet --
  // so a fetch that resolves late can't overwrite a fresher selection.
  // When it does change the mode, it carries open panels over exactly like
  // the Settings toggle does: the boot-time mode (seeded from localStorage)
  // can differ from the backend's, and a Queue/Lyrics panel restored or
  // opened before the fetch resolves would otherwise be left open in a
  // mode that can't render it.
  hydrateExclusiveSidePanels: (value) => set(s => {
    if (s.exclusiveSidePanelsUserSet || s.exclusiveSidePanels === value) return s
    return sidePanelModeTransition(s, value)
  }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setCrossfade: (v) => set({ crossfadeSeconds: v }),

  sleepTimerMinutes: 0,
  sleepTimerEndTime: null,
  sleepTimerInterval: null,
  showMiniPlayer: false,
  // Resizes (and awaits) the native window BEFORE flipping showMiniPlayer,
  // rather than after -- App.jsx swaps between MiniPlayer and the full app
  // UI the instant showMiniPlayer changes, so if that flip happens first,
  // React mounts the new UI while the OS window is still the OLD size, and
  // only catches up once the async setMiniMode IPC call resolves. That
  // produced a visible flash of the wrong-size content in the wrong-size
  // window on every transition. Awaiting the resize first means the window
  // is already correct by the time the UI actually swaps.
  toggleMiniPlayer: () => {
    // Chain onto the previous call's settled promise (not just fire a new
    // one) so overlapping calls run one at a time; `.catch(() => {})` keeps
    // a prior failure from blocking this attempt.
    miniModeToggleChain = miniModeToggleChain.catch(() => {}).then(async () => {
      const next = !get().showMiniPlayer
      const electron = typeof window !== 'undefined' ? window.electron : null
      if (electron) {
        try {
          if (electron.setMiniMode) {
            // The main-process handler resolves false (rather than
            // rejecting) when there's no window to apply it to -- the
            // native mode didn't change, so don't commit it to the store.
            const applied = await electron.setMiniMode(next)
            if (applied === false) {
              console.error('Failed to toggle mini player: setMiniMode returned false')
              return
            }
          } else if (next) {
            if (electron.getWindowSize) {
              miniModeFallbackPrevSize = await electron.getWindowSize().catch(() => null)
            }
            if (electron.setAlwaysOnTop) await electron.setAlwaysOnTop(true)
            // Matches MINI_DEFAULT_WIDTH/HEIGHT in electron/main.js's
            // setMiniMode handler; MiniPlayer will report the final content
            // height after it mounts.
            if (electron.setWindowSize) await electron.setWindowSize(420, 246)
          } else {
            if (electron.setAlwaysOnTop) await electron.setAlwaysOnTop(false)
            if (miniModeFallbackPrevSize && electron.setWindowSize) {
              await electron.setWindowSize(miniModeFallbackPrevSize[0], miniModeFallbackPrevSize[1])
            }
            miniModeFallbackPrevSize = null
          }
        } catch (err) {
          // The native resize/IPC call failed, so the OS window never
          // actually changed size -- committing showMiniPlayer here would
          // desync the UI (MiniPlayer vs. the full app layout) from the
          // window's real size. Leave the store as it was; the swallowed
          // catch here previously committed on failure too, silently.
          console.error('Failed to toggle mini player', err)
          return
        }
      }
      set({ showMiniPlayer: next })
    })
    return miniModeToggleChain
  },
  setSleepTimer: (minutes) => {
    const { sleepTimerInterval } = get()
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval)
    }
    
    if (minutes <= 0) {
      set({ sleepTimerMinutes: 0, sleepTimerEndTime: null, sleepTimerInterval: null })
      return
    }
    
    const endTime = Date.now() + (minutes * 60 * 1000)
    const interval = setInterval(() => {
      const { sleepTimerEndTime, isPlaying } = get()
      if (!sleepTimerEndTime) return
      
      if (Date.now() >= sleepTimerEndTime) {
        const { audioRef, cfAudioRef, activeAudioElement } = get()
        const activeRef = activeAudioElement === 'primary' ? audioRef : cfAudioRef
        if (activeRef?.current) {
          activeRef.current.pause()
        }
        set({ isPlaying: false, sleepTimerMinutes: 0, sleepTimerEndTime: null, sleepTimerInterval: null })
        clearInterval(interval)
      }
    }, 1000)
    
    set({ sleepTimerMinutes: minutes, sleepTimerEndTime: endTime, sleepTimerInterval: interval })
  },
  cancelSleepTimer: () => {
    const { sleepTimerInterval } = get()
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval)
    }
    set({ sleepTimerMinutes: 0, sleepTimerEndTime: null, sleepTimerInterval: null })
  },

  likedIds: new Set(),
  setLiked: (id, liked) => set(s => {
    const next = new Set(s.likedIds)
    liked ? next.add(id) : next.delete(id)
    return { likedIds: next }
  }),
  setLikedMany: (ids, liked) => set(s => {
    const next = new Set(s.likedIds)
    for (const id of ids || []) liked ? next.add(id) : next.delete(id)
    return { likedIds: next }
  }),
  initLiked: (ids) => set({ likedIds: new Set(ids) }),
  syncTrack: (track) => { announceTrackUpdates([track]); set((state) => {
    if (!track?.id) return state
    const syncList = (list) => sanitizeTrackList(Array.isArray(list) ? list.map(item => item?.id === track.id ? { ...item, ...track } : item) : list)
    const nextCurrent = state.currentTrack?.id === track.id ? { ...state.currentTrack, ...track } : state.currentTrack
    const currentTrack = sanitizeSingleTrack(nextCurrent)
    return {
      queue: syncList(state.queue),
      shuffleQueue: syncList(state.shuffleQueue),
      originalQueue: syncList(state.originalQueue),
      currentTrack,
    }
  }) },
  syncTracks: (tracks) => { announceTrackUpdates(tracks); set((state) => {
    const updates = new Map((Array.isArray(tracks) ? tracks : []).filter(track => track?.id).map(track => [track.id, track]))
    if (!updates.size) return state
    const syncList = (list) => sanitizeTrackList(Array.isArray(list) ? list.map(item => item?.id && updates.has(item.id) ? { ...item, ...updates.get(item.id) } : item) : list)
    const nextCurrent = state.currentTrack?.id && updates.has(state.currentTrack.id)
      ? { ...state.currentTrack, ...updates.get(state.currentTrack.id) }
      : state.currentTrack
    const currentTrack = sanitizeSingleTrack(nextCurrent)
    return {
      queue: syncList(state.queue),
      shuffleQueue: syncList(state.shuffleQueue),
      originalQueue: syncList(state.originalQueue),
      currentTrack,
    }
  }) },
}))

export const useAppStore = create((set, get) => ({
  user: loadUser(),
  showAuthModal: false, authMode: 'login',
  showCreatePlaylistModal: false,
  showProfileModal: false,
  showAlbumsModal: false,
  selectedAlbum: null,
  addToPlaylistTrack: null,
  addToPlaylistTrackIds: [],

  setUser: (user) => set({ user }),
  logout: () => { set({ user: null }); localStorage.removeItem('lokal-user') },
  openAuth: (mode = 'login') => set({ showAuthModal: true, authMode: mode }),
  closeAuth: () => set({ showAuthModal: false }),
  openCreatePlaylist: () => set({ showCreatePlaylistModal: true }),
  closeCreatePlaylist: () => set({ showCreatePlaylistModal: false }),
  openProfile: () => set({ showProfileModal: true }),
  closeProfile: () => set({ showProfileModal: false }),
  openAlbums: (album = null) => set({ showAlbumsModal: true, selectedAlbum: album }),
  closeAlbums: () => set({ showAlbumsModal: false, selectedAlbum: null }),
  openAddToPlaylist: (track) => set({ addToPlaylistTrack: track, addToPlaylistTrackIds: [track.id] }),
  openAddMultipleToPlaylist: (trackIds) => set({ addToPlaylistTrack: null, addToPlaylistTrackIds: trackIds }),
  closeAddToPlaylist: () => set({ addToPlaylistTrack: null, addToPlaylistTrackIds: [] }),
}))

// The queue is saved for the next session (queueStorage.js): only when part
// of it changed (not on every progress tick), at most about once a second,
// and once more when the window closes. If the full queue doesn't fit, the
// songs around the current one are kept.
let queueSaveTimer = null
let lastSavedQueue = null
function saveQueueNow() {
  clearTimeout(queueSaveTimer)
  queueSaveTimer = null
  const state = usePlayerStore.getState()
  for (const limit of [Infinity, 500, 100]) {
    try {
      localStorage.setItem('lokal-queue', JSON.stringify(packQueue(state, { limit })))
      return
    } catch {}
  }
  console.error('Failed to save queue to localStorage')
}
usePlayerStore.subscribe((state) => {
  const current = QUEUE_KEYS.map(key => state[key])
  if (lastSavedQueue && current.every((value, i) => value === lastSavedQueue[i])) return
  lastSavedQueue = current
  if (!queueSaveTimer) queueSaveTimer = setTimeout(saveQueueNow, 800)
})
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (queueSaveTimer) saveQueueNow() })
  window.addEventListener('beforeunload', () => { if (queueSaveTimer) saveQueueNow() })
}
