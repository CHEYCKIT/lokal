// Home's Made for you presentation is selected explicitly in Lokal settings.
// Windows / macOS accessibility preferences never choose between the two.
import React from 'react'
import CoverFlow from './CoverFlow'
import ClassicMadeForYou from './ClassicMadeForYou'
import { useTranslation } from '../i18n'
import { useAppearanceFlag } from '../appearanceFlags'

export default function MadeForYou({ picks, onPlay, onContextMenu }) {
  const { t } = useTranslation()
  const coverFlow = useAppearanceFlag('home_cover_flow')
  if (!picks.length) return null
  if (!coverFlow) return <ClassicMadeForYou picks={picks} onPlay={onPlay} onContextMenu={onContextMenu} />
  return <section aria-roledescription="carousel" aria-label={t('Made for you')}>
    <CoverFlow picks={picks} onPlay={onPlay} onContextMenu={onContextMenu} />
  </section>
}
