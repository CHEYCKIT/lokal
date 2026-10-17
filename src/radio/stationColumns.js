// The online radio station list's columns: the same kind of settings as the
// song lists (shown or not, order, widths, row size and spacing; see
// src/trackColumns.js) but its own set, saved separately, so changing one
// list never changes the other. Widths in rem; a flex column's width is a weight.

import { ROW_GAP, ROW_SIZE, MAX_FIXED_WIDTH } from '../trackColumns.js'

export const STATION_COLUMN_DEFS = {
  number: { label: 'Row number', fixed: 2, min: 1.5 },
  title: { label: 'Station', flex: 3, min: 11 },
  genre: { label: 'Genre', flex: 1.2, min: 5 },
  comment: { label: 'Comment', flex: 2, min: 6 },
  history: { label: 'History', flex: 2, min: 6 },
  nowPlaying: { label: 'Now playing', flex: 2.5, min: 8 },
  stream: { label: 'Stream', fixed: 6, min: 4 },
}
export const STATION_DEFAULT_ORDER = ['number', 'title', 'genre', 'comment', 'history', 'nowPlaying', 'stream']
export const STATION_ALWAYS_SHOWN = new Set(['title'])
// Shown inside Station: switched on and off, not moved.
export const STATION_OTHER_OPTIONS = [['artwork', 'Icon']]
const TOGGLES = ['number', 'artwork', 'genre', 'comment', 'history', 'nowPlaying', 'stream']

export function stationColumnDefaults() {
  return { number: true, artwork: true, genre: true, comment: true, history: true, nowPlaying: true, stream: false }
}

/** The saved order, minus unknown keys, with any newer column in its default place. */
export function stationColumnOrder(saved) {
  const order = Array.isArray(saved) ? saved.filter(key => key in STATION_COLUMN_DEFS) : []
  STATION_DEFAULT_ORDER.forEach((key, index) => {
    if (order.includes(key)) return
    const before = STATION_DEFAULT_ORDER.slice(0, index).reverse().find(k => order.includes(k))
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, key)
  })
  return [...new Set(order)]
}

export function stationColumnPreferences(saved) {
  const result = stationColumnDefaults()
  for (const key of TOGGLES) if (typeof saved?.[key] === 'boolean') result[key] = saved[key]
  result.order = stationColumnOrder(saved?.order)
  result.widths = saved?.widths && typeof saved.widths === 'object' ? saved.widths : {}
  const size = Number(saved?.rowSize)
  result.rowSize = Number.isFinite(size) ? Math.min(ROW_SIZE.max, Math.max(ROW_SIZE.min, size)) : ROW_SIZE.initial
  const gap = Number(saved?.rowGap)
  result.rowGap = saved?.rowGap != null && Number.isFinite(gap) ? Math.min(ROW_GAP.max, Math.max(ROW_GAP.min, gap)) : ROW_GAP.initial
  return result
}

/** The column's width: rem for a fixed one, a weight for a flex one. */
export function stationColumnWidth(key, widths) {
  const def = STATION_COLUMN_DEFS[key]
  const saved = Number(widths?.[key])
  if (def?.flex) return saved > 0 ? saved : def.flex
  return saved > 0 ? Math.min(MAX_FIXED_WIDTH, Math.max(def?.min || 2, saved)) : def.fixed
}

/**
 * Which columns fit a list `width` rem wide, in the user's order, and the
 * grid template header and rows share. Station is always there; the others
 * drop out (least useful first) when there isn't room.
 */
export function stationColumnLayout(width, columns) {
  const visible = { title: true }
  const widths = columns.widths || {}
  let remaining = width - 2 - STATION_COLUMN_DEFS.title.min - 0.5
  const size = key => (STATION_COLUMN_DEFS[key].flex ? STATION_COLUMN_DEFS[key].min : stationColumnWidth(key, widths))
  for (const key of ['number', 'nowPlaying', 'genre', 'comment', 'history', 'stream']) {
    visible[key] = !!columns[key] && remaining >= size(key) + 0.5
    if (visible[key]) remaining -= size(key) + 0.5
  }
  const order = (columns.order || STATION_DEFAULT_ORDER).filter(key => visible[key])
  const template = order.map(key => (STATION_COLUMN_DEFS[key].flex ? `minmax(0,${stationColumnWidth(key, widths)}fr)` : `${stationColumnWidth(key, widths)}rem`)).join(' ')
  return { ...visible, order, template }
}
