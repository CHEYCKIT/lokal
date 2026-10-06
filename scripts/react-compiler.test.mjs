import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { COMPILED, isCompiled } from '../vite.config.mjs'

const require = createRequire(import.meta.url)
const babel = require('@babel/core')

// Property paths the compiled code reads during render to check its memo
// cache, reviewed: each object is always there when the component renders.
// The compiler reads these even where the source only reads them in a
// handler behind a null check, so a new one here needs the same review
// (or the file comes off the list in vite.config.mjs).
const REVIEWED = {
  QueuePanel: ['displayQueue.length'], // always an array
  LyricsPanel: ['line.time', 'line.bgWords', 'line.text', 'line.words', 'line.bgText'], // Row's line prop
  ContextMenu: ['state?.items'], // null-safe
}

function compile(name) {
  const file = path.join('src', 'components', `${name}.jsx`)
  const compiled = []
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file, babelrc: false, configFile: false, parserOpts: { plugins: ['jsx'] },
    plugins: [['babel-plugin-react-compiler', { logger: { logEvent(_, event) { if (event.kind === 'CompileSuccess') compiled.push(event.fnName) } } }]],
  })
  // Ordinary and optional-chain steps alike (`a.b`, `a?.b`, `a?.b.c`).
  const paths = new Set([...code.matchAll(/\$\[\d+\] !== ([A-Za-z_$][\w$]*(?:\??\.[\w$]+)+)/g)].map(m => m[1]))
  return { compiled, paths: [...paths] }
}

for (const name of COMPILED) {
  test(`${name}: compiled, reading only reviewed property paths during render`, () => {
    const { compiled, paths } = compile(name)
    assert.ok(compiled.length > 0, `the compiler skips everything in ${name}; take it off the list`)
    const unreviewed = paths.filter(p => !(REVIEWED[name] || []).includes(p))
    assert.deepEqual(unreviewed, [], `${name} now reads ${unreviewed.join(', ')} during render: check each object can't be null there`)
  })
}

test('the listed files are picked out on any platform', () => {
  assert.equal(isCompiled('/home/me/lokal/src/components/QueuePanel.jsx'), true)
  assert.equal(isCompiled('C:/Users/me/lokal/src/components/QueuePanel.jsx'), true) // what Vite passes on Windows
  assert.equal(isCompiled('C:\\Users\\me\\lokal\\src\\components\\QueuePanel.jsx'), true)
  assert.equal(isCompiled('/home/me/lokal/src/components/QueuePanel.jsx?v=123'), true)
  assert.equal(isCompiled('/home/me/lokal/src/components/ProfileModal.jsx'), false)
  assert.equal(isCompiled('/home/me/lokal/src/pages/QueuePanel.jsx'), false)
})
