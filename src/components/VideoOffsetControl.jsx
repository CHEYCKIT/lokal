// Nudging a music video against the song, for when the automatic sync is
// off (an intro before the song starts, say). Kept per video.

import React from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useVideoOffsets, VIDEO_OFFSET_STEP } from '../musicVideo'

const label = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2).replace(/\.?0+$/, '')} s`

export default function VideoOffsetControl({ videoId, compact = false, className = '' }) {
  const { t } = useTranslation()
  const offset = useVideoOffsets(state => state.offsets[videoId] || 0)
  const setOffset = useVideoOffsets(state => state.setOffset)
  if (!videoId) return null
  // Shift steps a whole second.
  const nudge = (event, direction) => { event.stopPropagation(); setOffset(videoId, offset + direction * (event.shiftKey ? 1 : VIDEO_OFFSET_STEP)) }
  const button = compact
    ? 'flex h-6 w-6 items-center justify-center rounded-full text-white/85 hover:bg-white/15 hover:text-white'
    : 'flex h-8 w-8 items-center justify-center rounded-full text-white/85 hover:bg-white/15 hover:text-white'
  return (
    <div role="group" aria-label={t("Video offset")} onClick={event => event.stopPropagation()}
      className={`inline-flex items-center gap-0.5 rounded-full border border-white/[0.14] bg-black/45 backdrop-blur-md ${compact ? 'px-0.5 py-0.5 text-[10px]' : 'px-1 py-0.5 text-xs'} ${className}`}>
      <button type="button" onClick={event => nudge(event, -1)} className={button}
        title={t("Video ahead of the song? Move it back (Shift: 1 s)")} aria-label={t("Move the video back")}>
        <Minus size={compact ? 11 : 14} />
      </button>
      {/* Fixed widths, and the reset button always there (greyed at 0): the
          buttons stay put while the value changes. */}
      <span className={`select-none whitespace-nowrap px-1 tabular-nums ${offset ? 'text-white' : 'text-white/65'}`} title={t("Offset: how far the video is moved against the song")}>
        {!compact && 'Offset '}
        <span className={`inline-block text-center ${compact ? 'w-[4.6em]' : 'w-[4.8em]'}`}>{offset ? label(offset) : compact ? 'Offset' : '0 s'}</span>
      </span>
      <button type="button" onClick={event => nudge(event, 1)} className={button}
        title={t("Video behind the song (an intro, say)? Move it forward (Shift: 1 s)")} aria-label={t("Move the video forward")}>
        <Plus size={compact ? 11 : 14} />
      </button>
      <button type="button" onClick={event => { event.stopPropagation(); setOffset(videoId, 0) }} disabled={offset === 0}
        className={`${button} disabled:pointer-events-none disabled:opacity-30`} title={t("Back to no offset (the automatic sync)")} aria-label={t("Reset the video offset")}>
        <RotateCcw size={compact ? 10 : 13} />
      </button>
    </div>
  )
}
