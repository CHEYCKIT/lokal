// Home's Made for you uses the same iPod-style Cover Flow as Lokal Mobile.
import React from 'react'
import { Sparkles } from 'lucide-react'
import CoverFlow from './CoverFlow'
import { useTranslation } from '../i18n'

export default function MadeForYou({ picks, onPlay, onContextMenu, onOpenFlow }) {
  const { t } = useTranslation()
  if (!picks.length) return null
  return <section aria-roledescription="carousel" aria-label={t('Made for you')}>
    <div className="mb-3 flex items-center justify-center gap-2">
      <Sparkles size={14} className="text-accent" />
      <h2 className="text-xs font-display uppercase tracking-widest text-accent">{t('Made for you')}</h2>
    </div>
    <CoverFlow picks={picks} onPlay={onPlay} onContextMenu={onContextMenu} onOpenFlow={onOpenFlow} />
  </section>
}
