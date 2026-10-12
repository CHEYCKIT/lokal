// The player while casting. Lokal keeps the queue (what plays next, shuffle,
// repeat, autoplay) and the TV keeps the clock (where in the song, playing
// or paused): this computer's audio is parked (App.jsx), the TV is told the
// playing song and the next few (castWindow), and the player follows what the
// TV reports, moving on with it when it starts the next song by itself.
//
// Listening time, Last.fm and ListenBrainz count as they do here: the
// listening timer runs while the TV plays.

import { useEffect, useLayoutEffect, useRef } from 'react'
import { api } from '../api'
import { usePlayerStore, setOutputRoute } from '../store/player'
import { useCastStore } from './castStore'
import { castWindow, windowKey, castPosition, locate } from './castWindow'
import { showToast } from '../components/Toaster'

const SYNC_DELAY_MS = 120 // a burst of queue changes (a drag, an album added) is one update
const TICK_MS = 250
const VOLUME_EVERY_MS = 120
const VOLUME_SETTLE_MS = 1000 // the TV's reports lag a slider being dragged

// Where the song was when casting ended: this computer carries on from there.
let resumeAt = null
export function takeResumePosition(trackId) {
  const pending = resumeAt
  resumeAt = null
  return pending && String(pending.trackId) === String(trackId) ? pending.position : null
}

export function useCastPlayback(helpers) {
  const ref = useRef(helpers)
  useLayoutEffect(() => { ref.current = helpers })

  useEffect(() => {
    if (!api.castAvailable()) return
    const player = usePlayerStore.getState
    const cast = useCastStore.getState
    const call = (name, ...args) => { try { return ref.current?.[name]?.(...args) } catch {} }

    let live = null
    const fresh = () => ({
      anchor: { position: 0, at: Date.now(), playing: false },
      tvTrackId: null, // the TV's song, as last reported
      tvPlaying: null, // the TV playing (true) or paused (false), as last reported
      commands: 0, // play / pause on their way: reports from before them are stale
      syncs: 0,
      syncTimer: null,
      syncPending: false,
      songPending: false, // the player changed song; the next window carries play / pause
      sentKey: null,
      sentCurrent: null,
      localVolume: null,
      volumeAt: 0,
      volumeTimer: null,
      volumeNext: null,
      finishedFor: null,
      startedFor: null, // the song whose listen was started (Last.fm, ListenBrainz)
      lastPosition: 0,
      device: null,
    })

    const duration = () => Number(player().duration) || Number(player().currentTrack?.duration) || 0
    const now = () => castPosition(live?.anchor, Date.now(), duration())

    // ------------------------------------------------------------ the TV's window

    const scheduleSync = (options = {}) => {
      if (!live) return
      clearTimeout(live.syncTimer)
      live.syncPending = true
      live.syncTimer = setTimeout(() => sendWindow(options), options.immediate ? 0 : SYNC_DELAY_MS)
    }

    const sendWindow = async ({ position = 0, play, force = false, reload = false } = {}) => {
      if (!live) return
      const session = live
      session.syncPending = false
      const window = castWindow(player())
      if (!window) return
      const key = windowKey(window)
      if (!force && !reload && key === session.sentKey) { session.songPending = false; return }
      const changedSong = String(window.current.id) !== session.sentCurrent
      session.sentKey = key
      session.sentCurrent = String(window.current.id)
      session.songPending = false
      session.syncs++
      try {
        await api.castSetWindow({
          current: window.current,
          upcoming: window.upcoming,
          repeat: window.repeat,
          position: changedSong || reload ? position : undefined,
          play: play ?? player().isPlaying,
          reload,
        })
      } catch {} finally { session.syncs-- }
    }

    // ------------------------------------------------------------ the player moving on

    /** The TV started another song by itself (the next one, or one picked on the TV): the player follows. */
    const follow = trackId => {
      const state = player()
      const found = locate(state, trackId)
      if (!found) return
      const history = [...(state.playHistory || []), found.track.id]
      usePlayerStore.setState({
        ...(found.shuffleIndex != null ? { shuffleIndex: found.shuffleIndex } : {}),
        queueIndex: found.queueIndex,
        currentTrack: found.track,
        playHistory: history,
        futureHistory: [],
      })
    }

    const onSongChanged = track => {
      if (!live || !track) return
      live.anchor = { position: 0, at: Date.now(), playing: false }
      live.finishedFor = null
      live.startedFor = null
      live.lastPosition = 0
      usePlayerStore.setState({ progress: 0, duration: Number(track.duration) || 0 })
      call('topUpRelated')
    }

    const onIntent = playing => {
      if (!live || live.songPending) return // the new song's window says it
      if (playing === live.tvPlaying) return // it came from the TV, or it already is
      live.anchor = { position: now(), at: Date.now(), playing: false }
      if (playing && cast().status?.playerState === 'IDLE') {
        // The TV played to the end: start the song again from where the player is.
        sendWindow({ position: player().progress || 0, play: true, reload: true })
        return
      }
      live.commands++
      const session = live
      api.castCommand({ type: playing ? 'play' : 'pause' }).catch(() => {}).finally(() => { session.commands-- })
    }

    // ------------------------------------------------------------ what the TV reports

    const onStatus = status => {
      if (!live || status?.state !== 'connected') return
      const state = player()
      if (status.volume && Date.now() - live.volumeAt > VOLUME_SETTLE_MS && Math.abs(Number(status.volume.level) - state.volume) > 0.001) {
        usePlayerStore.setState({ volume: Number(status.volume.level) })
      }
      usePlayerStore.setState({ isBuffering: status.playerState === 'LOADING' || status.playerState === 'BUFFERING' })

      const tvTrack = status.trackId ? String(status.trackId) : null
      if (tvTrack && tvTrack !== live.tvTrackId) {
        live.tvTrackId = tvTrack
        // Not while the player's own change is on its way: the TV still reports the song before it.
        if (tvTrack !== String(state.currentTrack?.id) && !live.syncPending && live.syncs === 0 && !live.songPending) follow(tvTrack)
      }
      const current = player().currentTrack
      if (!current || String(current.id) !== tvTrack) return // still on the song before

      const playing = status.playerState === 'PLAYING'
      const position = Math.max(0, Number(status.position) || 0)
      const length = Number(status.duration) || Number(current.duration) || 0
      // Repeat-one runs on the TV: back at the start, it's another listen.
      if (playing && length > 10 && live.lastPosition > length - 5 && position < 3) {
        call('flushTime', current.id)
        call('beginLastfmPlayback', current)
        live.startedFor = String(current.id)
      }
      live.anchor = { position, at: Number(status.positionAt) || Date.now(), playing }
      live.lastPosition = now()
      usePlayerStore.setState({ progress: live.lastPosition, ...(length ? { duration: length } : {}) })

      if (status.playerState === 'PLAYING' || status.playerState === 'PAUSED') {
        live.tvPlaying = playing
        if (playing) live.finishedFor = null
        if (live.commands === 0 && !live.songPending && player().isPlaying !== playing) player().setIsPlaying(playing)
        if (playing) {
          call('startTimer')
          if (live.startedFor !== String(current.id)) { call('beginLastfmPlayback', current); live.startedFor = String(current.id) }
          call('sendListenBrainzNowPlaying')
        } else call('stopTimer')
      } else if (status.playerState === 'IDLE') {
        live.tvPlaying = false
        call('stopTimer')
      }
    }

    /** The TV played everything it held: on to the next song, or the end of the queue. */
    const onFinished = () => {
      if (!live) return
      const state = player()
      const id = String(state.currentTrack?.id || '')
      if (!id || live.tvTrackId !== id || live.finishedFor === id || live.syncs > 0 || live.syncPending) return
      live.finishedFor = id
      call('stopTimer')
      const before = state.currentTrack
      state.autoNext()
      if (player().currentTrack !== before) return
      call('flushTime', id)
      if (state.repeat === 'all') { sendWindow({ position: 0, play: true, reload: true }); return }
      live.tvPlaying = false
      live.anchor = { position: 0, at: Date.now(), playing: false }
      usePlayerStore.setState({ isPlaying: false, progress: 0 })
    }

    const onTrackError = info => {
      if (!live) return
      const state = player()
      if (String(info?.trackId) !== String(state.currentTrack?.id)) return
      showToast(`Couldn't play "${state.currentTrack?.title || 'this song'}" on ${live.device?.name || 'the TV'}${info?.message ? `: ${info.message}` : ''}`)
      const before = state.currentTrack
      state.autoNext()
      if (player().currentTrack === before) usePlayerStore.setState({ isPlaying: false })
    }

    // ------------------------------------------------------------ starting and ending

    const route = {
      seek: position => {
        if (!live) return
        const at = Math.max(0, Number(position) || 0)
        live.anchor = { ...live.anchor, position: at, at: Date.now() }
        live.lastPosition = at
        if (cast().status?.playerState === 'IDLE') { sendWindow({ position: at, play: player().isPlaying, reload: true }); return }
        api.castCommand({ type: 'seek', position: at }).catch(() => {})
      },
      setVolume: level => {
        if (!live) return
        live.volumeAt = Date.now()
        live.volumeNext = level
        if (live.volumeTimer) return
        const session = live
        const flush = () => {
          session.volumeTimer = null
          if (session.volumeNext == null) return
          const next = session.volumeNext
          session.volumeNext = null
          api.castCommand({ type: 'volume', level: next }).catch(() => {})
          session.volumeTimer = setTimeout(flush, VOLUME_EVERY_MS)
        }
        flush()
      },
    }

    const activate = ({ joined }) => {
      if (live) return
      const status = cast().status || {}
      const state = player()
      live = fresh()
      live.device = status.device || null
      live.localVolume = state.volume
      let position = state.progress || 0
      let play = !!state.isPlaying
      // This computer goes quiet (App.jsx parks its audio) before anything else moves.
      usePlayerStore.setState({ castActive: true })
      call('stopTimer')
      setOutputRoute(route)
      // A session already playing Lokal's music (Lokal restarted, or the
      // connection came back): the player picks up the TV's song where it is.
      if (joined && status.trackId && locate(state, status.trackId)) {
        if (String(status.trackId) !== String(state.currentTrack?.id)) follow(status.trackId)
        live.tvTrackId = String(status.trackId)
        live.sentCurrent = String(status.trackId)
        play = status.playerState === 'PLAYING' || status.playerState === 'BUFFERING'
        live.anchor = { position: Number(status.position) || 0, at: Number(status.positionAt) || Date.now(), playing: status.playerState === 'PLAYING' }
        position = now()
      } else {
        live.anchor = { position, at: Date.now(), playing: false }
      }
      usePlayerStore.setState({
        isPlaying: play,
        progress: position,
        ...(status.volume ? { volume: Number(status.volume.level) } : {}),
      })
      sendWindow({ position, play, force: true })
    }

    const deactivate = ({ reason, last }) => {
      if (!live) return
      const session = live
      live = null
      clearTimeout(session.syncTimer)
      clearTimeout(session.volumeTimer)
      call('stopTimer')
      setOutputRoute(null)
      const state = player()
      const sameSong = last?.trackId && String(last.trackId) === String(state.currentTrack?.id)
      const position = sameSong
        ? castPosition({ position: Number(last.position) || 0, at: Number(last.positionAt) || Date.now(), playing: last.playerState === 'PLAYING' }, Date.now(), Number(last.duration) || 0)
        : castPosition(session.anchor, Date.now(), Number(state.duration) || 0)
      resumeAt = state.currentTrack ? { trackId: state.currentTrack.id, position } : null
      // "Play on this computer" carries on playing; the TV going away pauses.
      const keepPlaying = reason === 'local' && state.isPlaying
      usePlayerStore.setState({
        castActive: false,
        isPlaying: keepPlaying,
        isBuffering: false,
        progress: position,
        volume: session.localVolume ?? state.volume,
      })
      if (reason === 'lost') showToast(`Lost the connection to ${session.device?.name || 'the TV'}. Paused here.`)
      else if (reason === 'stopped') showToast(`Casting to ${session.device?.name || 'the TV'} ended. Paused here.`)
    }

    // ------------------------------------------------------------ wiring

    const offPlayer = usePlayerStore.subscribe((state, prev) => {
      if (!live) return
      const songChanged = String(state.currentTrack?.id || '') !== String(prev.currentTrack?.id || '')
      if (songChanged) {
        // Moved by the player (not following the TV): its window carries play / pause.
        if (String(state.currentTrack?.id || '') !== live.tvTrackId) live.songPending = true
        onSongChanged(state.currentTrack)
      }
      if (songChanged || state.queue !== prev.queue || state.shuffleQueue !== prev.shuffleQueue || state.queueIndex !== prev.queueIndex
        || state.shuffleIndex !== prev.shuffleIndex || state.repeat !== prev.repeat || state.shuffle !== prev.shuffle) scheduleSync()
      if (state.isPlaying !== prev.isPlaying) onIntent(state.isPlaying)
    })

    const offCast = useCastStore.subscribe((state, prev) => {
      if (state.session && state.session !== prev.session) activate(state.session)
      if (state.ended && state.ended !== prev.ended) deactivate(state.ended)
    })

    const offs = [
      api.onCastDevices(list => cast().setDevices(list)),
      api.onCastStatus(status => { cast().setStatus(status); onStatus(status) }),
      api.onCastEnded(info => cast().endedRemotely(info)),
      api.onCastFinished(() => onFinished()),
      api.onCastTrackError(info => onTrackError(info)),
    ]

    const tick = setInterval(() => {
      if (!live?.anchor?.playing) return
      live.lastPosition = now()
      usePlayerStore.setState({ progress: live.lastPosition })
    }, TICK_MS)

    // A session left running by a reload of the window: picked up again.
    api.castStatus().then(status => {
      if (status?.state === 'connected' && !live) {
        cast().setStatus(status)
        useCastStore.setState({ session: { joined: true, at: Date.now() } })
      }
    }).catch(() => {})

    return () => {
      clearInterval(tick)
      offPlayer()
      offCast()
      for (const off of offs) { try { off?.() } catch {} }
      if (live) { clearTimeout(live.syncTimer); clearTimeout(live.volumeTimer) }
      setOutputRoute(null)
    }
  }, [])
}
