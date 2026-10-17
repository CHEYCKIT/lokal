import React, { useState } from 'react'
import { ChevronDown, ChevronUp, GripVertical, Info } from 'lucide-react'
import { SIDEBAR_ITEMS as TABS } from '../sidebarNav'
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
  const [dragged, setDragged] = useState(null)
  const [over, setOver] = useState(null)

  const save = next => onChange(JSON.stringify(next))
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
          </div>
        )
      })}
    </div>
  )
}
