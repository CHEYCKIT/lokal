import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useReleaseRefresh } from '../store/releaseRefresh'
import { useTranslation } from '../i18n'

export default function ReleaseRefreshBanner() {
  const { t } = useTranslation()
  const status = useReleaseRefresh()
  const location = useLocation()
  if (!status.running || location.pathname === '/albums') return null
  const percent = status.total ? (status.done / status.total) * 100 : 0
  return (
    <div className="border-b border-border bg-elevated px-6 py-3">
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span>{t('Refreshing releases · {done} of {total}', { done: status.done.toLocaleString(), total: status.total.toLocaleString() })}</span>
        <Link to="/albums" className="text-accent">{t('View releases')}</Link>
      </div>
      <div role="progressbar" aria-label={t('Release refresh')} aria-valuemin={0} aria-valuemax={status.total || 1} aria-valuenow={status.done} className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
