import test from 'node:test'
import assert from 'node:assert/strict'
import { likeBatch, MAX_TRIES } from '../src/spotifyLikeBatch.js'

const item = (n, addedAt = n * 1000) => ({ uri: `spotify:track:${String(n).padStart(22, '0')}`, title: `Song ${n}`, artist: 'A', addedAt })
const fresh = () => ({ tries: new Map(), done: new Set() })

test('all liked: the next look starts after the newest', async () => {
  const state = fresh()
  const result = await likeBatch([item(1), item(2)], { ...state, newest: 2500, resolve: i => ({ id: i.title }), like: () => true })
  assert.deepEqual(result, { liked: 2, through: 2500 })
})

test('one not found (or offline) holds the starting point before it, and is tried again', async () => {
  const state = fresh()
  let offline = true
  const resolve = i => (i.title === 'Song 2' && offline ? Promise.reject(new Error('offline')) : { id: i.title })
  const liked = []
  const like = row => { liked.push(row.id); return true }
  const first = await likeBatch([item(1), item(2), item(3)], { ...state, newest: 3000, resolve, like })
  assert.deepEqual(first, { liked: 2, through: 1000 }, 'song 3 is liked, but the look starts again after song 1')
  offline = false
  const second = await likeBatch([item(2), item(3)], { ...state, newest: 3000, resolve, like })
  assert.deepEqual(second, { liked: 1, through: 3000 })
  assert.deepEqual(liked, ['Song 1', 'Song 3', 'Song 2'], 'song 3 is not liked twice')
})

test('a song never found is let go after a few looks', async () => {
  const state = fresh()
  const resolve = i => (i.title === 'Song 1' ? null : { id: i.title })
  let result
  for (let n = 1; n <= MAX_TRIES; n++) result = await likeBatch([item(1), item(2)], { ...state, newest: 2000, resolve, like: () => true })
  assert.equal(result.through, 2000)
})

test('liked at the same moment as one handled: still found next time', async () => {
  const state = fresh()
  const result = await likeBatch([item(1, 5000), item(2, 5000)], { ...state, newest: 5000, resolve: i => (i.title === 'Song 2' ? null : { id: i.title }), like: () => true })
  assert.equal(result.through, 4999)
})
