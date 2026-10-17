// Online radio: the user's stations (from the catalogue they link in
// Settings > Online Radio, or here the first time), one row each, like a
// song list. Picking one plays it live.

import React, { useEffect } from 'react'
import { Radio } from 'lucide-react'
import { usePageReady } from '../pageCache'
import { useRadioStore } from '../store/radio'
import { useAppearanceText } from '../appearanceFlags'
import { useTranslation } from '../i18n'
import RadioCatalogSetup from '../components/RadioCatalogSetup'
import StationList from '../components/StationList'

export default function Stations() {
  const { t } = useTranslation()
  const { ready, catalog, init } = useRadioStore()
  const configUrl = useAppearanceText('radio_config_page_url', '')
  useEffect(() => { init() }, [init])
  usePageReady(ready)

  if (!ready) return null

  if (!catalog) {
    return (
      <div className="p-6 max-w-3xl mx-auto pb-10 space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted mb-2">{t('Live from the web')}</p>
          <h1 className="text-3xl font-display text-white flex items-center gap-3"><Radio size={26} className="text-accent" />{t('Online Radio')}</h1>
          <p className="text-sm text-muted mt-2">{t('Give the link to your station catalogue: a JSON file listing your stations. It\'s downloaded once and kept; you can change the link or update it any time in Settings > Online Radio.')}</p>
        </div>
        <RadioCatalogSetup />
      </div>
    )
  }

  const header = (
    <div className="min-w-0">
      <h1 className="min-w-0 truncate font-display text-lg uppercase tracking-widest text-white" title={catalog.title || t('Online Radio')}>{catalog.title || t('Online Radio')}</h1>
      <p className="text-xs text-muted">{t('{n} station|{n} stations', { n: catalog.stations.length })}</p>
    </div>
  )
  return (
    <div className="relative px-6 pt-0 pb-10 min-h-full">
      <StationList catalog={catalog} configUrl={/^https?:\/\//i.test(configUrl.trim()) ? configUrl.trim() : ''} toolbarStart={header} stickyBleed="1.5rem" />
    </div>
  )
}
