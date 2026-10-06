// A pasted list of songs, one per line: "Artist - Title", or just "Title".
// Shared by the desktop IPC and the web routes (playlist import, "From a list").

const MAX_LINES = 10000

function parseTextList(content) {
  const entries = []
  for (const raw of String(content || '').split(/\r?\n/)) {
    // Numbering and bullets people paste along ("1.", "2)", "-", "•").
    const line = raw.trim().replace(/^(?:\d+[.)]\s+|[-•*]\s+)/, '').trim()
    if (!line) continue
    const dash = line.lastIndexOf(' - ')
    entries.push(dash > 0
      ? { artist: line.slice(0, dash).trim() || null, title: line.slice(dash + 3).trim() || line }
      : { artist: null, title: line })
    if (entries.length >= MAX_LINES) break
  }
  return entries
}

module.exports = { parseTextList }
