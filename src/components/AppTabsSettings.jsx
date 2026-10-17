import React, { useState } from 'react'
import { ChevronDown, ChevronUp, GripVertical, Info, X, Plus } from 'lucide-react'
import { SIDEBAR_ITEMS as TABS, DEFAULT_SIDEBAR_ORDER, REMOVED_PREFIX } from '../sidebarNav'
import { HIDDEN_MARK, tabOrder } from '../appTabs'
import { useTranslation } from '../i18n'

/**
 * Settings > Appearance > Navigation: reorder sidebar items; those below the line
 * are tucked into the More menu.
 * `value` is the saved `app_tabs` setting; onChange gets the new one.
 */
export default function AppTabsSettings({ value, onChange }) {
  const { t } = useTranslation()
  const order = tabOrder(value)
  const byPath = Object.fromEntries(TABS.map(tab => [tab.path, tab]))
  let savedItems = []
  try { savedItems = typeof value === 'string' && value ? JSON.parse(value) : Array.isArray(value) ? value : [] } catch {}
  const removedPaths = [...new Set((Array.isArray(savedItems) ? savedItems : []).filter(item => typeof item === 'string' && item.startsWith(REMOVED_PREFIX)).map(item => item.slice(REMOVED_PREFIX.length).trim()).filter(path => byPath[path]))]
  const [dragged, setDragged] = useState(null)
  const [over, setOver] = useState(null)

  const save = (next, removed = removedPaths) => onChange(JSON.stringify([...next, ...removed.map(path => REMOVED_PREFIX + path)]))
  const remove = path => save(order.filter(item => item !== path), [...removedPaths, path].filter((item, index, all) => all.indexOf(item) === index))
  const restore = path => {
    const next = [...order]
    const following = DEFAULT_SIDEBAR_ORDER.slice(DEFAULT_SIDEBAR_ORDER.indexOf(path) + 1).find(item => item !== HIDDEN_MARK && next.includes(item))
    if (following) next.splice(next.indexOf(following), 0, path)
    else next.splice(next.indexOf(HIDDEN_MARK), 0, path)
    save(next, removedPaths.filter(item => item !== path))
  }
  const move = (from, to) => {
    if (from === to || to < 0 || to >= order.length) return
    const next = [...order]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    save(next)
  }

  return (
    <div className="space-y-1" onDragEnd={() => { setDragged(null); setOver(null) }}>
      {order.map((path, index) => {
        if (path === HIDDEN_MARK) {
          return (
            <div key={path} className="flex items-center gap-2 py-2"
              onDragOver={event => { if (dragged != null) { event.preventDefault(); setOver(index) } }}
              onDrop={event => { event.preventDefault(); if (dragged != null) move(dragged, index); setDragged(null); setOver(null) }}>
              <div className={`h-px flex-1 ${over === index ? 'bg-accent' : 'bg-border'}`} />
              <span title={t('Items below the line are tucked into the More menu at the bottom of the sidebar.')} aria-label={t('Tabs below the line go to the extra ⋯ menu at the end of the tab bar.')}
                className="flex cursor-help items-center gap-1 text-[11px] text-muted">
                <Info size={13} />
              </span>
              <div className={`h-px flex-1 ${over === index ? 'bg-accent' : 'bg-border'}`} />
            </div>
          )
        }
        const tab = byPath[path]
        if (!tab) return null
        const Icon = tab.icon
        const hidden = index > order.indexOf(HIDDEN_MARK)
        return (
          <div key={path} draggable
            onDragStart={event => { setDragged(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', path) }}
            onDragOver={event => { if (dragged != null) { event.preventDefault(); setOver(index) } }}
            onDrop={event => { event.preventDefault(); if (dragged != null) move(dragged, index); setDragged(null); setOver(null) }}
            className={`flex items-center gap-2.5 rounded-lg border px-2 py-1.5 text-sm transition-colors ${over === index && dragged !== index ? 'border-accent/60' : 'border-border'} ${dragged === index ? 'opacity-50' : ''} ${hidden ? 'bg-card/50 text-muted' : 'bg-card text-white'}`}>
            <GripVertical size={14} className="flex-shrink-0 cursor-grab text-muted active:cursor-grabbing" />
            <Icon size={14} className="flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t(tab.label)}</span>
            <button type="button" onClick={() => move(index, index - 1)} disabled={index === 0}
              title={t('Move up')} aria-label={t('Move up')} className="rounded p-0.5 text-muted hover:text-white disabled:opacity-30">
              <ChevronUp size={14} />
            </button>
            <button type="button" onClick={() => move(index, index + 1)} disabled={index === order.length - 1}
              title={t('Move down')} aria-label={t('Move down')} className="rounded p-0.5 text-muted hover:text-white disabled:opacity-30">
              <ChevronDown size={14} />
            </button>
            <button type="button" onClick={() => remove(path)}
              title={t('Remove section from navigation')} aria-label={t('Remove {section} from navigation', { section: t(tab.label) })}
              className="rounded p-0.5 text-muted hover:text-red-300">
              <X size={14} />
            </button>
          </div>
        )
      })}
      {removedPaths.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <p className="text-xs text-muted">{t('Hidden sections')}</p>
          {removedPaths.map(path => {
            const tab = byPath[path]
            if (!tab) return null
            const Icon = tab.icon
            return (
              <div key={path} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-2 py-1.5 text-sm text-muted">
                <Icon size={14} className="flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t(tab.label)}</span>
                <button type="button" onClick={() => restore(path)} title={t('Restore section')} aria-label={t('Restore {section}', { section: t(tab.label) })}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-accent hover:bg-accent/10">
                  <Plus size={13} /> {t('Restore')}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
