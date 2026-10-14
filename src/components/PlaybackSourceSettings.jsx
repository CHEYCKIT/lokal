import { useTranslation } from '../i18n'
import React, { useEffect, useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { api } from '../api'
import { DEFAULT_PLAYBACK_SOURCES, movePlaybackSource, orderedPlaybackSources } from '../playbackSources'

export default function PlaybackSourceSettings({ value, onChange }) {
  const { t } = useTranslation()
  const [available, setAvailable] = useState(DEFAULT_PLAYBACK_SOURCES)
  useEffect(() => {
    let active = true
    let latest = 0
    const load = () => {
      const request = ++latest
      return Promise.resolve().then(() => api.onlineProviders()).then(result => {
        if (active && request === latest && Array.isArray(result) && result.length) setAvailable(result)
      }).catch(() => {})
    }
    load()
    window.addEventListener('lokal:addons-changed', load)
    return () => { active = false; window.removeEventListener('lokal:addons-changed', load) }
  }, [])
  const sources = orderedPlaybackSources(value, available)
  const move = (index, direction) => onChange(JSON.stringify(movePlaybackSource(value, available, index, direction)))
  return <ol className="space-y-2" aria-label={t("Playback search priority")}>
    {sources.map((source, index) => <li key={source.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <span className="text-xs text-muted">{index + 1}</span>
      <span className="flex-1 text-sm text-white">{t(source.label)}{source.addon ? ` (${t('addon')})` : ''}</span>
      <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t('Move {source} up', { source: t(source.label) })} className="text-muted hover:text-white disabled:opacity-30"><ChevronUp size={16} /></button>
      <button type="button" onClick={() => move(index, 1)} disabled={index === sources.length - 1} aria-label={t('Move {source} down', { source: t(source.label) })} className="text-muted hover:text-white disabled:opacity-30"><ChevronDown size={16} /></button>
    </li>)}
  </ol>
}
