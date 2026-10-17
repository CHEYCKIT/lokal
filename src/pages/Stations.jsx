// Online radio: local catalogue and live station playback.
import React, { useEffect, useState } from 'react'
import { Radio, Settings2 } from 'lucide-react'
import { usePageReady } from '../pageCache'
import { useRadioStore, RADIO_BUFFER_MAX, radioBufferSeconds } from '../store/radio'
import { useAppearanceText } from '../appearanceFlags'
import { useTranslation } from '../i18n'
import { api } from '../api'
import RadioCatalogSetup from '../components/RadioCatalogSetup'
import StationList from '../components/StationList'

function RadioSettingsPanel({ settings, setSettings, t }) {
  const [saving, setSaving] = useState(false)
  const changeBuffer = async value => {
    const patch = { radio_buffer_sec: String(Math.max(0, Math.min(RADIO_BUFFER_MAX, Number(value) || 0))) }
    setSaving(true)
    try {
      const result = await api.saveSettings(patch)
      if (!result?.error) setSettings(current => ({ ...current, ...patch }))
    } finally { setSaving(false) }
  }
  return (
    <details className="mb-5 rounded-xl border border-border bg-card/70">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-white">
        <Settings2 size={15} className="text-muted" /> {t('Radio settings')}
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-white">{t('Station catalogue')}</p>
          <p className="text-xs text-muted">{t('Load the JSON file that lists your Internet radio stations. The station list is kept locally and can be refreshed from here.')}</p>
          <RadioCatalogSetup showExample={false} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-white">{t('Radio buffer')}</p>
            <p className="max-w-xl text-xs text-muted">{t('Buffer a few seconds before playing to reduce dropouts. Larger values add more delay before the stream starts.')}</p>
          </div>
          <select aria-label={t('Radio buffer')} disabled={saving} value={radioBufferSeconds(settings.radio_buffer_sec)} onChange={e => changeBuffer(e.target.value)}
            className="bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent/50 disabled:opacity-50">
            {[0,1,2,3,4,5,6,8,10].map(seconds => <option key={seconds} value={seconds}>{t('{n} seconds', { n: seconds })}</option>)}
          </select>
        </div>
      </div>
    </details>
  )
}

export default function Stations() {
  const { t } = useTranslation()
  const { ready, catalog, init } = useRadioStore()
  const configUrl = useAppearanceText('radio_config_page_url', '')
  const [settings, setSettings] = useState({})
  useEffect(() => { init() }, [init])
  useEffect(() => { api.getSettings().then(value => setSettings(value || {})).catch(() => {}) }, [])
  usePageReady(ready)

  if (!ready) return null

  if (!catalog) {
    return (
      <div className="p-6 max-w-3xl mx-auto pb-10 space-y-5">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted mb-2">{t('Live from the web')}</p>
          <h1 className="text-3xl font-display text-white flex items-center gap-3"><Radio size={26} className="text-accent" />{t('Radio')}</h1>
          <p className="text-sm text-muted mt-2">{t('Give the link to your station catalogue: a JSON file listing your stations. It\'s downloaded once and kept; you can change the link or update it any time in Radio settings.')}</p>
        </div>
        <RadioSettingsPanel settings={settings} setSettings={setSettings} t={t} />
      </div>
    )
  }

  const header = (
    <div className="min-w-0">
      <h1 className="min-w-0 truncate font-display text-lg uppercase tracking-widest text-white" title={catalog.title || t('Radio')}>{catalog.title || t('Radio')}</h1>
      <p className="text-xs text-muted">{t('{n} station|{n} stations', { n: catalog.stations.length })}</p>
    </div>
  )
  return (
    <div className="relative px-6 pt-0 pb-10 min-h-full">
      <RadioSettingsPanel settings={settings} setSettings={setSettings} t={t} />
      <StationList catalog={catalog} configUrl={/^https?:\/\//i.test(configUrl.trim()) ? configUrl.trim() : ''} toolbarStart={header} stickyBleed="1.5rem" />
    </div>
  )
}
