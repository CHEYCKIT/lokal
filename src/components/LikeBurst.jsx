import React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Heart, HeartCrack } from 'lucide-react'

// Drawn over the middle of the cover when it is double-clicked: a heart pops and
// floats away when the song is liked, a cracked one shakes and drops when it is
// un-liked. Sparks are [angle in degrees, distance in rem, size in rem].
const SPARKS = [
  [-90, 11, 1.1], [-50, 9.5, 0.8], [-130, 9.5, 0.8], [-15, 8, 0.65],
  [-165, 8, 0.65], [-70, 6.5, 0.55], [-110, 6.5, 0.55], [20, 6, 0.5],
]

const GLOW = 'drop-shadow-[0_6px_24px_rgba(0,0,0,0.5)]'

function Spark({ angle, distance, size }) {
  const rad = (angle * Math.PI) / 180
  return (
    <motion.span
      className="absolute text-accent"
      style={{ width: `${size}rem`, height: `${size}rem` }}
      initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
      animate={{ x: `${Math.cos(rad) * distance}rem`, y: `${Math.sin(rad) * distance}rem`, scale: [0, 1, 0.7], opacity: [0, 1, 0] }}
      transition={{ duration: 0.85, delay: 0.1, ease: 'easeOut' }}
    >
      <Heart size="100%" fill="currentColor" strokeWidth={0} />
    </motion.span>
  )
}

function Liked({ reduce }) {
  return (
    <>
      {!reduce && (
        <motion.span
          className="absolute aspect-square w-[30%] rounded-full border-2 border-white/70"
          initial={{ scale: 0.5, opacity: 0.9 }}
          animate={{ scale: 3, opacity: 0 }}
          transition={{ duration: 0.75, ease: 'easeOut' }}
        />
      )}
      {!reduce && SPARKS.map(([angle, distance, size]) => <Spark key={angle} angle={angle} distance={distance} size={size} />)}
      <motion.div
        className={`aspect-square w-[36%] text-accent ${GLOW}`}
        initial={{ scale: 0, opacity: 0, rotate: -14 }}
        animate={reduce
          ? { scale: 1, opacity: [0, 1, 1, 0] }
          : { scale: [0, 1.3, 1, 1, 0.92], opacity: [0, 1, 1, 1, 0], rotate: [-14, 6, 0, 0, 0], y: [0, 0, 0, -8, -30] }}
        transition={reduce
          ? { duration: 0.8, times: [0, 0.2, 0.7, 1] }
          : { duration: 1.05, times: [0, 0.2, 0.34, 0.72, 1], ease: 'easeOut' }}
      >
        <Heart size="100%" fill="currentColor" strokeWidth={1.5} />
      </motion.div>
    </>
  )
}

function Unliked({ reduce }) {
  return (
    <motion.div
      className={`aspect-square w-[34%] text-white ${GLOW}`}
      initial={{ opacity: 0, scale: 1.2 }}
      animate={reduce
        ? { scale: 1, opacity: [0, 1, 1, 0] }
        : { opacity: [0, 1, 1, 0], scale: [1.2, 1, 1, 0.8], y: [0, 0, 4, 44], rotate: [0, 0, -4, 10] }}
      transition={{ duration: reduce ? 0.8 : 0.95, times: [0, 0.18, 0.6, 1], ease: 'easeIn' }}
    >
      <motion.div
        className="h-full w-full"
        animate={reduce ? undefined : { x: [0, -9, 9, -6, 6, -2, 0] }}
        transition={{ delay: 0.15, duration: 0.42 }}
      >
        <HeartCrack size="100%" strokeWidth={1.6} />
      </motion.div>
    </motion.div>
  )
}

export default function LikeBurst({ kind }) {
  const reduce = !!useReducedMotion()
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      {kind === 'unlike' ? <Unliked reduce={reduce} /> : <Liked reduce={reduce} />}
    </div>
  )
}
