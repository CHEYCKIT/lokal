import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const videoOffsetControl = await readFile(new URL('../src/components/VideoOffsetControl.jsx', import.meta.url), 'utf8')
const recapStory = await readFile(new URL('../src/components/RecapStory.jsx', import.meta.url), 'utf8')

test('the music video offset control imports the translation hook it renders with', () => {
  assert.match(videoOffsetControl, /import\s+\{\s*useTranslation\s*\}\s+from\s+['"]\.\.\/i18n['"]/)
  assert.match(videoOffsetControl, /const\s+\{\s*t\s*\}\s*=\s*useTranslation\(\)/)
})

test('the recap slide visual receives the locale used for session duration formatting', () => {
  assert.match(recapStory, /<SlideVisual[^>]*\blanguage=\{language\}/)
  assert.match(recapStory, /function\s+SlideVisual\(\{[^}]*\blanguage[^}]*\}\)/)
})
