import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lyricsSearchSnippet } from '../src/lyricsSearchSnippet.mjs'

test('online lyric previews show a matching line separately from metadata', () => {
  assert.equal(lyricsSearchSnippet({ syncedLyrics: '[ar:Singer]\n[00:02.10]First line\n[00:04.00]The words you wanted' }, 'words you wanted'), 'The words you wanted')
  assert.equal(lyricsSearchSnippet({ plainLyrics: '\nFirst line\nSecond line\nThird line' }, 'Song title'), 'First line · Second line')
  assert.equal(lyricsSearchSnippet({ syncedLyrics: '[ar:Singer]\n[00:00.00]' }), '')
  assert.ok(lyricsSearchSnippet({ plainLyrics: 'x'.repeat(400) }).length <= 240)
})

test('library and online lyrics use the same library result card', () => {
  for (const path of ['../src/pages/Search.jsx', '../src/components/OnlineLyricsSearch.jsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /<LyricsSearchResult/)
    assert.match(source, /snippet=/)
  }
  const online = readFileSync(new URL('../src/components/OnlineLyricsSearch.jsx', import.meta.url), 'utf8')
  assert.match(online, /lyricsSearchSnippet\(row, q\)/)
  assert.match(online, /playRecommendationPool/)
})

test('the shared card renders title, metadata, lyric preview and disabled play action', async () => {
  const { createServer } = await import('vite')
  const React = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { default: Card } = await server.ssrLoadModule('/src/components/LyricsSearchResult.jsx')
    const html = renderToStaticMarkup(React.createElement(Card, {
      title: 'Song title', artist: 'Singer', album: 'Album', snippet: 'A lyric line', disabled: true,
    }))
    assert.match(html, /Song title/)
    assert.match(html, /Singer.*Album/)
    assert.match(html, /mt-2 truncate.*A lyric line/)
    assert.match(html, /rounded-xl border border-border/)
    assert.match(html, /disabled=""/)
  } finally { await server.close() }
})
