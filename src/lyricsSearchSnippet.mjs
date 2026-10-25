/** Prefer a matching lyric line; LRC metadata/timestamps are not preview text. */
export function lyricsSearchSnippet(record, query = '') {
  const lines = String(record.plainLyrics || record.syncedLyrics || '').split(/\r?\n/)
    .map(line => line.replace(/\[(?:\d{1,3}:\d{2}(?:[.:]\d{1,3})?|(?:ar|ti|al|by|offset|length|re|ve):[^\]]*)\]/gi, '').trim()).filter(Boolean)
  const needle = String(query).trim().toLocaleLowerCase()
  const match = needle && lines.find(line => line.toLocaleLowerCase().includes(needle))
  return (match || lines.slice(0, 2).join(' · ')).slice(0, 240)
}
