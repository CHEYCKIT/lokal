import { create } from 'zustand'

function isGhostTrack(track) {
  return String(track?.file_path || '').startsWith('ghost://')
}

function sanitizeTrackList(tracks) {
  return Array.isArray(tracks) ? tracks.filter(track => track?.id && !isGhostTrack(track)) : []
}

function sanitizeSingleTrack(track) {
  return track?.id && !isGhostTrack(track) ? track : null
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

function loadQueue() {
  try {
    const data = localStorage.getItem('lokal-queue')
    if (!data) return null
    const parsed = JSON.parse(data)

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

export const usePlayerStore = create((set, get) => ({
  queue: [], queueIndex: -1, currentTrack: null,
  playbackContext: null,
  isPlaying: false, progress: 0, duration: 0,
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
  // True once the user has explicitly picked a Side Panels mode this
  // session (via the Settings toggle). Lets hydrateExclusiveSidePanels
  // (the backend-persisted value, fetched async at app boot and again on
  // Settings mount) tell a fresher live choice apart from the stale
  // localStorage-seeded default, so a slow response can never clobber a
  // selection the user already made while it was in flight.
  exclusiveSidePanelsUserSet: false,
  audioRef: null, cfAudioRef: null, crossfadeSeconds: 0, _fetchingRelated: false,
  activeAudioElement: 'primary',

  originalQueue: [], 
  shuffleQueue: [], 
  shuffleIndex: -1, 
  playHistory: [], 
  futureHistory: [], 
  wasShuffled: false, 

  ...(savedQueueState || {}),

  setAudioRef: (ref) => set({ audioRef: ref }),
  setCfAudioRef: (ref) => set({ cfAudioRef: ref }),
  setActiveAudioElement: (el) => set({ activeAudioElement: el }),
  setFetchingRelated: (v) => set({ _fetchingRelated: v }),
  appendRelated: (tracks) => {
    const { queue } = get()
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

  playTrack: (track, queue = null, context = null) => {
    const playableTrack = sanitizeSingleTrack(track)
    if (!playableTrack) return
    const q = sanitizeTrackList(queue || get().queue)
    if (!q.length) return
    const idx = Math.max(q.findIndex(t => t.id === playableTrack.id), 0)
    
    if (get().shuffle) {
      get().initShuffleQueue(q, idx)
    }
    
    set({ 
      currentTrack: playableTrack, 
      queue: q, 
      queueIndex: idx, 
      isPlaying: true, 
      playbackContext: context || null,
      playHistory: [playableTrack.id],
      futureHistory: []
    })
  },

  playQueue: (tracks, startIndex = 0, context = null) => {
    const sanitizedTracks = sanitizeTrackList(tracks)
    if (!sanitizedTracks.length) return
    
    const safeIndex = Math.min(Math.max(startIndex, 0), sanitizedTracks.length - 1)
    const startTrack = sanitizedTracks[safeIndex]
    
    if (get().shuffle) {
      get().initShuffleQueue(sanitizedTracks, safeIndex)
    }
    
    set({ 
      queue: sanitizedTracks, 
      queueIndex: safeIndex, 
      currentTrack: startTrack, 
      isPlaying: true,
      playbackContext: context || null,
      playHistory: startTrack ? [startTrack.id] : [],
      futureHistory: []
    })
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
  toggleLyrics: () => set(s => ({ showLyrics: !s.showLyrics })),
  toggleLyricsFullscreen: () => set(s => ({ showLyricsFullscreen: !s.showLyricsFullscreen })),
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
  toggleFullscreen: () => set(s => ({ showFullscreen: !s.showFullscreen })),
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
  // The user's own explicit mode choice (the Settings toggle). Carries
  // over whichever panel is currently open instead of just dropping it:
  // switching to merged mode folds a visible standalone Queue panel into
  // the sidebar's Queue view; switching to independent mode reopens a
  // visible merged Queue overlay as the standalone panel. Either way, a
  // panel that's about to become unrenderable in the new mode never gets
  // left stuck open in the old one.
  setExclusiveSidePanels: (value) => {
    try { localStorage.setItem('lokal-exclusive-panels', value ? '1' : '0') } catch {}
    set(s => {
      if (value && s.showQueue) {
        return {
          exclusiveSidePanels: value,
          exclusiveSidePanelsUserSet: true,
          showQueue: false,
          showRightSidebar: true,
          sidePanelView: 'queue',
        }
      }
      if (!value && s.showRightSidebar && s.sidePanelView === 'queue') {
        return {
          exclusiveSidePanels: value,
          exclusiveSidePanelsUserSet: true,
          showQueue: true,
          sidePanelView: 'info',
        }
      }
      return {
        exclusiveSidePanels: value,
        exclusiveSidePanelsUserSet: true,
        // Any other stale 'queue' reference can't be shown as a closed
        // panel in either mode -- fall back to info so neither renderer
        // starts on a view it doesn't own.
        sidePanelView: s.sidePanelView === 'queue' ? 'info' : s.sidePanelView,
      }
    })
  },
  // Syncs the backend-persisted Side Panels setting in (called once at app
  // boot, and again when Settings mounts). A no-op once the user has made
  // their own live choice this session -- see exclusiveSidePanelsUserSet --
  // so a fetch that resolves late can't overwrite a fresher selection.
  hydrateExclusiveSidePanels: (value) => set(s => (
    s.exclusiveSidePanelsUserSet ? {} : { exclusiveSidePanels: value }
  )),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setCrossfade: (v) => set({ crossfadeSeconds: v }),

  sleepTimerMinutes: 0,
  sleepTimerEndTime: null,
  sleepTimerInterval: null,
  showMiniPlayer: false,
  toggleMiniPlayer: () => set(s => ({ showMiniPlayer: !s.showMiniPlayer })),
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
  initLiked: (ids) => set({ likedIds: new Set(ids) }),
  syncTrack: (track) => set((state) => {
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
  }),
  syncTracks: (tracks) => set((state) => {
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
  }),
}))

export const useAppStore = create((set, get) => ({
  user: loadUser(),
  showAuthModal: false, authMode: 'login',
  showCreatePlaylistModal: false,
  showProfileModal: false,
  showStatsModal: false,
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
  openStats: () => set({ showStatsModal: true }),
  closeStats: () => set({ showStatsModal: false }),
  openAlbums: (album = null) => set({ showAlbumsModal: true, selectedAlbum: album }),
  closeAlbums: () => set({ showAlbumsModal: false, selectedAlbum: null }),
  openAddToPlaylist: (track) => set({ addToPlaylistTrack: track, addToPlaylistTrackIds: [track.id] }),
  openAddMultipleToPlaylist: (trackIds) => set({ addToPlaylistTrack: null, addToPlaylistTrackIds: trackIds }),
  closeAddToPlaylist: () => set({ addToPlaylistTrack: null, addToPlaylistTrackIds: [] }),
}))

usePlayerStore.subscribe((state) => {
  const {
    queue, queueIndex, currentTrack, shuffle, repeat, shuffleQueue,
    shuffleIndex, playHistory, futureHistory, wasShuffled, originalQueue,
    playbackContext,
  } = state

  const dataToSave = {
    queue, queueIndex, currentTrack, shuffle, repeat, shuffleQueue,
    shuffleIndex, playHistory, futureHistory, wasShuffled, originalQueue,
    playbackContext,
  }

  try {
    localStorage.setItem('lokal-queue', JSON.stringify(dataToSave))
  } catch (e) {
    console.error('Failed to save queue to localStorage', e)
  }
})
