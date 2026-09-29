// The cover's flight between the full-screen player and full-screen lyrics
// (FullscreenPlayer): a copy of the cover moves from one spot to the other
// while the real ones stay hidden.
//
// The two spots don't share a shape: with a Spotify Canvas the player's card
// is 9:16 and the lyrics header's cover is square. Scaling one picture from
// one to the other stretches it, so the copy is a frame whose shape morphs
// while the pictures inside keep their own proportions (only cropped, like
// object-fit: cover): the frame is scaled per axis and each picture is scaled
// back the other way, frame by frame (the "scale correction" framer-motion
// layout animations use). Everything moves by transform and opacity alone, so
// the compositor runs it, smooth even while the lyrics keep playing.
//
// A canvas keeps playing through the flight: its current frame is copied at
// once, a copy of the video takes over from the same point, and it crossfades
// into the album cover the lyrics header shows (or back, the other way).

const STEPS = 40 // points per animation: the correction is exact at each

const lerp = (from, to, t) => from + (to - from) * t

/** The frame's box on screen at progress t (0 to 1). */
function boxAt(from, to, t) {
  return { left: lerp(from.left, to.left, t), top: lerp(from.top, to.top, t), width: lerp(from.width, to.width, t), height: lerp(from.height, to.height, t) }
}

/**
 * The transforms that keep a picture of natural size `content` ({ width,
 * height }) covering the frame, without stretching, at each step.
 */
function coverFrames(from, to, content) {
  const frames = []
  for (let i = 0; i <= STEPS; i++) {
    const box = boxAt(from, to, i / STEPS)
    const sx = box.width / from.width
    const sy = box.height / from.height
    const m = Math.max(box.width / content.width, box.height / content.height)
    const ox = (box.width - content.width * m) / 2
    const oy = (box.height - content.height * m) / 2
    frames.push({ offset: i / STEPS, transform: `translate(${ox / sx}px, ${oy / sy}px) scale(${m / sx}, ${m / sy})` })
  }
  return frames
}

function frameTransforms(from, to) {
  const frames = []
  for (let i = 0; i <= STEPS; i++) {
    const box = boxAt(from, to, i / STEPS)
    frames.push({ offset: i / STEPS, transform: `translate(${box.left - from.left}px, ${box.top - from.top}px) scale(${box.width / from.width}, ${box.height / from.height})` })
  }
  return frames
}

/** Rounded corners that stay round while the frame is scaled per axis. */
function cornerFrames(from, to, radius) {
  const frames = []
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS
    const box = boxAt(from, to, t)
    const r = lerp(radius[0], radius[1], t)
    frames.push({ offset: t, borderRadius: `${r / (box.width / from.width)}px / ${r / (box.height / from.height)}px` })
  }
  return frames
}

function layer(content, child) {
  const element = document.createElement('div')
  Object.assign(element.style, {
    position: 'absolute', left: '0px', top: '0px', width: `${content.width}px`, height: `${content.height}px`,
    transformOrigin: '0 0', willChange: 'transform',
  })
  element.appendChild(child)
  return element
}

function fill(element) {
  Object.assign(element.style, { position: 'absolute', inset: '0px', width: '100%', height: '100%', objectFit: 'cover', display: 'block' })
  return element
}

/**
 * The canvas as it is now: its current frame drawn at once (a new video
 * needs a moment to show its first one), then a copy of the video playing
 * from the same point on top.
 */
function canvasCopy(video) {
  const holder = document.createElement('div')
  fill(holder)
  try {
    const still = fill(document.createElement('canvas'))
    still.width = video.videoWidth
    still.height = video.videoHeight
    still.getContext('2d').drawImage(video, 0, 0)
    holder.appendChild(still)
  } catch {}
  const copy = fill(document.createElement('video'))
  Object.assign(copy, { muted: true, loop: true, playsInline: true, preload: 'auto' })
  copy.style.opacity = '0'
  copy.style.transition = 'opacity 120ms linear'
  copy.addEventListener('loadedmetadata', () => { try { copy.currentTime = video.currentTime } catch {} }, { once: true })
  copy.addEventListener('playing', () => { copy.style.opacity = '1' }, { once: true })
  copy.src = video.currentSrc || video.src
  copy.play().catch(() => {})
  holder.appendChild(copy)
  return { element: holder, stop: () => { copy.pause(); copy.removeAttribute('src'); copy.load() } }
}

/**
 * Fly the cover from `from` to `to` (DOMRects) inside `parent`.
 * @param art       the album cover URL (what the lyrics header shows)
 * @param video     the canvas playing in the player's card, if one is
 * @param card      the player card's size (the canvas's shape), { width, height }
 * @param toLyrics  true when flying into the lyrics header
 * @returns { finished: Promise, cancel() }
 */
export function startCoverFlight({ parent, from, to, art, video, card, toLyrics, radius, timing }) {
  const frame = document.createElement('div')
  Object.assign(frame.style, {
    position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
    overflow: 'hidden', zIndex: '60', pointerEvents: 'none', transformOrigin: '0 0', willChange: 'transform',
    borderRadius: `${radius[0]}px`, boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
  })
  const animations = [
    frame.animate(frameTransforms(from, to), timing),
    frame.animate(cornerFrames(from, to, radius), timing),
  ]
  let canvas = null
  if (video && video.videoWidth) {
    canvas = canvasCopy(video)
    const canvasLayer = layer(card, canvas.element)
    frame.appendChild(canvasLayer)
    animations.push(canvasLayer.animate(coverFrames(from, to, card), timing))
  }
  const image = fill(document.createElement('img'))
  image.src = art
  image.alt = ''
  // The cover is square: its layer is one, as big as the card is tall (sharp at the big end).
  const side = Math.max(card.width, card.height)
  const artLayer = layer({ width: side, height: side }, image)
  frame.appendChild(artLayer)
  animations.push(artLayer.animate(coverFrames(from, to, { width: side, height: side }), timing))
  if (canvas) {
    // Canvas into cover on the way to the lyrics, cover into canvas on the way back.
    animations.push(artLayer.animate(toLyrics
      ? [{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1, offset: 0.85 }, { opacity: 1, offset: 1 }]
      : [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 0, offset: 0.6 }, { opacity: 0, offset: 1 }], timing))
  }
  parent.appendChild(frame)
  let done = false
  const cancel = () => {
    if (done) return
    done = true
    for (const animation of animations) animation.cancel()
    canvas?.stop()
    frame.remove()
  }
  return { finished: animations[0].finished, cancel }
}
