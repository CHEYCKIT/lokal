import test from 'node:test'
import assert from 'node:assert/strict'
import { pickMadeForYou, madeForYou, forgetMadeForYou } from '../src/madeForYou.js'

const mix = (id, n, from = 0) => ({ id, name: `Mix ${id}`, tracks: Array.from({ length: n }, (_, i) => ({ id: `t${from + i}`, title: `Song ${from + i}` })) })
let seed = 1
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

test('four songs from each of six mixes: 24, none twice, in mix order', () => {
  const mixes = [mix('a', 10, 0), mix('b', 10, 100), mix('c', 10, 200), mix('d', 10, 300), mix('e', 10, 400), mix('f', 10, 500), mix('g', 10, 600)]
  const picks = pickMadeForYou(mixes, { random })
  assert.equal(picks.length, 24)
  assert.equal(new Set(picks.map(p => p.track.id)).size, 24)
  assert.deepEqual(picks.map(p => p.mix.id), ['a', 'b', 'c', 'd', 'e', 'f'].flatMap(id => Array(4).fill(id)))
  assert.ok(picks.every(p => mixes.find(m => m.id === p.mix.id).tracks.includes(p.track)))
})

test('mixes sharing songs give others; small or few mixes give what they have', () => {
  const shared = [mix('a', 3, 0), mix('b', 3, 0), mix('c', 1, 50)]
  const picks = pickMadeForYou(shared, { random })
  assert.equal(new Set(picks.map(p => p.track.id)).size, picks.length)
  assert.equal(picks.filter(p => p.mix.id === 'b').length, 0, 'all songs of b were already picked')
  assert.equal(picks.length, 3 + 0 + 1)
  assert.deepEqual(pickMadeForYou([]), [])
})

test('picked once per start: the same list when the mixes reload with other songs', () => {
  forgetMadeForYou()
  const mixes = [mix('a', 10, 0), mix('b', 10, 100)]
  const first = madeForYou('u1', mixes, { random })
  const again = madeForYou('u1', [mix('a', 10, 900), mix('b', 10, 950)], { random: () => 0.999 })
  assert.equal(again, first, 'the very same list')
  assert.ok(madeForYou('u2', mixes, { random: () => 0 }).length > 0, 'each user their own')
  assert.deepEqual(madeForYou('u3', []), [], 'nothing until there are mixes')
  assert.ok(madeForYou('u3', mixes).length > 0)
})
