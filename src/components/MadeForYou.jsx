// Home's Made for you uses the same iPod-style Cover Flow as Lokal Mobile.
import React from 'react'
import CoverFlow from './CoverFlow'
import { useTranslation } from '../i18n'

export default function MadeForYou({ picks, onPlay, onContextMenu }) {
  const { t } = useTranslation()
  if (!picks.length) return null
  // Keep the shelf below subsequent Home sections in stacking order, while
  // allowing its fading reflection to remain visible underneath them.
  return <section className="relative z-0" aria-roledescription="carousel" aria-label={t('Made for you')}>
    <CoverFlow picks={picks} onPlay={onPlay} onContextMenu={onContextMenu} />
  </section>
}
