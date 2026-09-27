// A small, forgiving XML reader: just enough for TTML lyric documents.
//
// Node has no DOMParser, and the regex approach the old parser used could not
// tell a space *between* two spans (a word boundary) from two spans sitting
// flush against each other (two syllables of one word) -- which is the single
// most important thing a word-timed TTML document says. A real tree keeps text
// nodes where they are, so that distinction survives.
//
// Output nodes: { type: 'element', name, attrs, children } | { type: 'text', text }
// Names keep their prefixes ("ttm:agent", "itunes:key") since documents are
// matched by the qualified names providers actually emit.

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text) {
  if (!text || text.indexOf('&') === -1) return text
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code)) return match
      try { return String.fromCodePoint(code) } catch { return match }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : match
  })
}

function parseAttrs(source) {
  const attrs = {}
  const re = /([^\s=\/]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m
  while ((m = re.exec(source)) !== null) {
    attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4])
  }
  return attrs
}

function parseXml(input) {
  const src = String(input || '')
  const root = { type: 'element', name: '#document', attrs: {}, children: [] }
  const stack = [root]
  let i = 0
  const len = src.length

  const pushText = (text) => {
    if (!text) return
    const parent = stack[stack.length - 1]
    parent.children.push({ type: 'text', text: decodeEntities(text) })
  }

  while (i < len) {
    const lt = src.indexOf('<', i)
    if (lt === -1) { pushText(src.slice(i)); break }
    if (lt > i) pushText(src.slice(i, lt))

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4)
      i = end === -1 ? len : end + 3
      continue
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9)
      const text = src.slice(lt + 9, end === -1 ? len : end)
      stack[stack.length - 1].children.push({ type: 'text', text })
      i = end === -1 ? len : end + 3
      continue
    }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt + 2)
      i = end === -1 ? len : end + 1
      continue
    }

    // Find the end of this tag, skipping '>' inside quoted attribute values.
    let j = lt + 1
    let quote = null
    while (j < len) {
      const ch = src[j]
      if (quote) { if (ch === quote) quote = null }
      else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '>') break
      j++
    }
    const raw = src.slice(lt + 1, j)
    i = j + 1

    if (raw[0] === '/') {
      const name = raw.slice(1).trim()
      // Pop to the matching element; tolerate stray closers.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) { stack.length = k; break }
      }
      continue
    }

    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1) : raw
    const nameMatch = body.match(/^\s*([^\s\/>]+)/)
    if (!nameMatch) continue
    const node = { type: 'element', name: nameMatch[1], attrs: parseAttrs(body.slice(nameMatch[0].length)), children: [] }
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) stack.push(node)
  }
  return root
}

/** Local part of a possibly-prefixed name: "ttm:agent" -> "agent". */
function localName(name) {
  const idx = String(name || '').indexOf(':')
  return idx === -1 ? name : name.slice(idx + 1)
}

/** Attribute lookup that accepts any prefix: attr(node, 'key') finds itunes:key / lrc:key / key. */
function attr(node, name) {
  if (!node?.attrs) return undefined
  if (node.attrs[name] !== undefined) return node.attrs[name]
  for (const [key, value] of Object.entries(node.attrs)) {
    if (localName(key) === name) return value
  }
  return undefined
}

function* walk(node) {
  yield node
  for (const child of node.children || []) {
    if (child.type === 'element') yield* walk(child)
  }
}

function findAll(node, name) {
  const out = []
  for (const el of walk(node)) if (el !== node && localName(el.name) === name) out.push(el)
  return out
}

function findFirst(node, name) {
  for (const el of walk(node)) if (el !== node && localName(el.name) === name) return el
  return null
}

function textContent(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text
  return (node.children || []).map(textContent).join('')
}

module.exports = { parseXml, decodeEntities, localName, attr, findAll, findFirst, textContent, walk }
