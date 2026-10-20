// The side panel's Visualization + Lyrics tab: a picture at the top, the
// song's lyrics (synced or plain) under it, like the Details tab's cover over
// its info. The picture is, first that the song has:
//   1. its video, set by hand in Edit Track (any link or video file), looping
//      over the part its times give (see clipRange in ../clipVideo.js),
//   2. its Spotify Canvas (MotionCover's tall clip),
//   3. the side panel's own visualization.
// Both videos are muted, have no controls, can't be clicked, and stop with
// the song. While there are no lines to show (an instrumental, lyrics that
// can't be found, none found) the picture takes the whole panel.
// Under the lyrics, the album's colours (Settings > Visualizations > Now
// Playing > Colour Background, as strong as its Visualization + Lyrics
// slider says); the picture fades into them.

import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api'
import { usePlayerStore } from '../store/player'
import { usePlaybackSpeed } from '../playbackSpeed.mjs'
import { isWindowHidden, onWindowVisibility } from '../windowVisibility'
import { clipRange, clipZoomPreview, onClipZoomPreview, trackClipLoop } from '../clipVideo'
import { useAppearanceValue } from '../appearanceFlags'
import ArtworkBackdrop, { meshKeyFor, useArtworkBackdropEnabled } from './ArtworkBackdrop'
import MotionCover from './MotionCover'
import LyricsPanel from './LyricsPanel'

// How much of the panel the picture takes above the lyrics (which start
// where it has faded out).
// Settings > Visualizations > Now Playing moves the lyrics up or down from
// there (px; 0: right under it).
const PICTURE_SHARE = 46
const FADE = 'linear-gradient(to bottom, black 0%, black 52%, rgba(0,0,0,0.75) 68%, rgba(0,0,0,0.35) 84%, transparent 100%)'

/** The song's own video looping, muted: between its two times, or the part clipRange picks. */
function ClipLoop({ link, start, end, zoom = 0, onActive, onFail }) {
  const ref = useRef(null)
  const [src, setSrc] = useState(null)
  const [ready, setReady] = useState(false)
  // A YouTube video the stream can't play (age-restricted...) is tried once
  // more through yt-dlp's own link.
  const triedFallback = useRef(false)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const speed = usePlaybackSpeed(state => state.speed)
  const playingRef = useRef(isPlaying)
  playingRef.current = isPlaying

  // The muted clip follows the song's selected speed, not normal speed.
  useEffect(() => {
    const video = ref.current
    if (!video || !src) return
    try { video.defaultPlaybackRate = speed; video.playbackRate = speed } catch {}
  }, [src, speed])

  const resolve = (fallback) => {
    let current = true
    Promise.resolve(api.clipVideoSource?.(link, { fallback })).then(found => {
      if (!current) return
      if (found?.src) setSrc(found.src)
      else {
        if (found?.error) console.warn(`[clip] ${link}: ${found.error}`)
        onFail?.()
      }
    }).catch(() => { if (current) onFail?.() })
    return () => { current = false }
  }
  useEffect(() => {
    setSrc(null)
    setReady(false)
    triedFallback.current = false
    return resolve(false)
  }, [link]) // eslint-disable-line react-hooks/exhaustive-deps

  const onActiveRef = useRef(onActive)
  onActiveRef.current = onActive
  useEffect(() => () => onActiveRef.current?.(false), [])

  // Back to the start once past the end (checked every frame while it plays:
  // timeupdate comes only a few times a second).
  useEffect(() => {
    const v = ref.current
    if (!v || !src) return undefined
    let frame = 0
    const range = () => clipRange(start, end, v.duration)
    const stopAt = (to) => (Number.isFinite(v.duration) && v.duration > 0 ? Math.min(to, v.duration - 0.05) : to)
    const check = () => {
      const part = range()
      if (v.currentTime >= stopAt(part.end) || v.currentTime < part.start - 0.5) v.currentTime = part.start
      frame = requestAnimationFrame(check)
    }
    const run = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(check) }
    const halt = () => cancelAnimationFrame(frame)
    const ended = () => { v.currentTime = range().start; if (playingRef.current && !isWindowHidden()) v.play().catch(() => {}) }
    v.addEventListener('playing', run)
    v.addEventListener('pause', halt)
    v.addEventListener('ended', ended)
    return () => {
      halt()
      v.removeEventListener('playing', run)
      v.removeEventListener('pause', halt)
      v.removeEventListener('ended', ended)
    }
  }, [src, start, end])

  // Plays while the song does and someone can see it.
  useEffect(() => {
    const v = ref.current
    if (!v || !src) return
    if (isPlaying && !isWindowHidden()) v.play().catch(() => {})
    else v.pause()
  }, [src, isPlaying])
  useEffect(() => onWindowVisibility((hidden) => {
    const v = ref.current
    if (!v) return
    if (hidden || !playingRef.current) v.pause()
    else v.play().catch(() => {})
  }), [])

  if (!src) return null
  const show = () => { if (!ready) { setReady(true); onActive?.(true) } }
  const failed = () => {
    setReady(false)
    onActive?.(false)
    if (!triedFallback.current) {
      triedFallback.current = true
      setSrc(null)
      resolve(true)
    } else onFail?.()
  }
  return (
    <video
      ref={ref}
      key={src}
      src={src}
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      disableRemotePlayback
      controls={false}
      tabIndex={-1}
      aria-hidden="true"
      onLoadedMetadata={e => { e.currentTarget.currentTime = clipRange(start, end, e.currentTarget.duration).start }}
      onSeeked={show}
      onPlaying={show}
      onError={failed}
      onContextMenu={e => e.preventDefault()}
      className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
      // Zoomed in from its centre by the song's Edit Track setting (0-50 %).
      style={{ opacity: ready ? 1 : 0, transition: 'opacity 320ms ease', transform: zoom > 0 ? `scale(${1 + zoom / 100})` : undefined }}
    />
  )
}

export default function SideVisualLyrics({ track, progress, visual, visualBg, coverOff = false, wordSync, textScale, isAutoSynced }) {
  const loop = trackClipLoop(track)
  // Edit Track open on this song: the zoom being tried shows straight away.
  const [, setPreviewTick] = useState(0)
  useEffect(() => onClipZoomPreview(() => setPreviewTick(n => n + 1)), [])
  const zoom = clipZoomPreview(track?.id) ?? loop?.zoom ?? 0
  // Not the zoom: changing it only rescales the video playing.
  const loopKey = loop ? `${track?.id}:${loop.link}:${loop.start}:${loop.end}` : null
  // The video stays off for this song once it fails to play.
  const [failedLoop, setFailedLoop] = useState(null)
  const useLoop = !!loop && failedLoop !== loopKey
  const [loopOn, setLoopOn] = useState(false)
  const [canvasOn, setCanvasOn] = useState(false)
  const [idle, setIdle] = useState(false)
  const videoOn = (useLoop && loopOn) || (!useLoop && canvasOn)
  const fx = useArtworkBackdropEnabled()
  const strength = Math.max(0, Math.min(100, useAppearanceValue('side_lyrics_backdrop_strength', 50))) / 100
  const lyricsOffset = Math.max(-400, Math.min(400, useAppearanceValue('side_lyrics_offset', 0)))

  return (
    <div className="absolute inset-0" style={{ backgroundColor: 'rgb(var(--surface-rgb))' }}>
      {fx && strength > 0 && (
        <div className="pointer-events-none absolute inset-0" style={{ opacity: strength }}>
          <ArtworkBackdrop trackId={meshKeyFor(track)} />
        </div>
      )}
      <motion.div
        className="absolute inset-x-0 top-0 flex flex-col overflow-hidden"
        initial={false}
        animate={{ height: idle ? '100%' : `${PICTURE_SHARE}%` }}
        transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
        style={{
          backgroundColor: videoOn ? '#000000' : visualBg,
          // A long fade into the colours under the lyrics: no edge between them.
          WebkitMaskImage: idle ? 'none' : FADE,
          maskImage: idle ? 'none' : FADE,
        }}
      >
        {/* The built-in visualization only runs while no video shows. */}
        {!videoOn && visual}
        {useLoop ? (
          <ClipLoop key={loopKey} link={loop.link} start={loop.start} end={loop.end} zoom={zoom}
            onActive={setLoopOn} onFail={() => { setLoopOn(false); setFailedLoop(loopKey) }} />
        ) : (
          <MotionCover trackId={track?.id} only="tall" onActive={setCanvasOn} off={coverOff} className="pointer-events-none" />
        )}
      </motion.div>
      {/* The lyrics start under the picture (none of them over it), moved by the setting. */}
      <div className="absolute inset-x-0 bottom-0 pb-[var(--player-space,0px)]" style={{ top: `max(0px, calc(${PICTURE_SHARE}% + ${lyricsOffset}px))` }}>
        <div className="relative h-full min-h-0 overflow-hidden">
          <LyricsPanel track={track} progress={progress} darkMode wordSync={wordSync} fullscreen={false} textScale={textScale} isAutoSynced={isAutoSynced}
            idleVisual onIdleChange={setIdle} toolbarAtBottom />
        </div>
      </div>
    </div>
  )
}
