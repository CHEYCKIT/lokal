// Widths are in rem, including gaps, so larger text uses the compact layout
// sooner. Header and rows use the exact same template, never content-sized cells.
export const TRACK_COLUMN_OPTIONS = [
  ['number', 'Track number'],
  ['artwork', 'Artwork'],
  ['artist', 'Artist'],
  ['source', 'Source'],
  ['quality', 'Quality'],
  ['added', 'Date added'],
  ['time', 'Duration'],
  ['actions', 'Quick actions'],
  ['grip', 'Drag handle'],
]

export function trackColumnDefaults(showQuality = false, playlist = false) {
  return { number: true, artwork: true, artist: true, source: true, quality: showQuality, added: playlist, time: true, actions: true, grip: true }
}

export function trackColumnPreferences(saved, showQuality = false, playlist = false) {
  const result = trackColumnDefaults(showQuality, playlist)
  for (const [key] of TRACK_COLUMN_OPTIONS) {
    if (typeof saved?.[key] === 'boolean') result[key] = saved[key]
  }
  return result
}

export function trackColumnLayout(width, columns, { playlist = false, actionSlots = 0 } = {}) {
  const visible = {}
  // Padding, a readable Title, and the always-reachable More menu.
  let remaining = width - 2 - 11 - 1.25 - 0.5
  const fit = (key, size, enabled = true) => {
    visible[key] = enabled && remaining >= size + 0.5
    if (visible[key]) remaining -= size + 0.5
  }
  // Keep quality and the tiny source mark before less essential metadata.
  fit('quality', 4.5, columns.quality)
  fit('source', 2, columns.source)
  fit('album', 8)
  fit('time', 3, columns.time)
  fit('number', 2, columns.number)
  fit('added', 5.5, columns.added)
  fit('grip', 1, playlist && columns.grip)
  const extraActions = actionSlots * 1.25 + 1.5
  fit('actions', extraActions, columns.actions)
  const actionsWidth = visible.actions ? extraActions + 1.25 : 1.25
  const template = [
    visible.grip && '1rem',
    visible.number && '2rem',
    'minmax(0,3fr)',
    visible.album && 'minmax(0,2fr)',
    visible.source && '2rem',
    visible.quality && '4.5rem',
    visible.added && '5.5rem',
    visible.time && '3rem',
    `${actionsWidth}rem`,
  ].filter(Boolean).join(' ')
  return { ...visible, template }
}
