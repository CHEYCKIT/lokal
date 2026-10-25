import test from 'node:test'
import assert from 'node:assert/strict'
import { artworkCandidates } from '../src/artworkQuality.mjs'

test('Amazon CDN original replaces resize transform but retains valid fallback', () => {
  const small = 'https://m.media-amazon.com/images/I/abcdef._AC_UX120_.jpg'
  assert.deepEqual(artworkCandidates(small), [
    'https://m.media-amazon.com/images/I/abcdef.jpg', small,
  ])
})

test('YouTube Music Google thumbnails are promoted without discarding crop', () => {
  const small = 'https://lh3.googleusercontent.com/abc=w120-h120-l90-rj'
  assert.deepEqual(artworkCandidates(small), [
    'https://lh3.googleusercontent.com/abc=w1200-h1200-l90-rj', small,
  ])
  const square = 'https://lh3.googleusercontent.com/abc=s120-c-k-c0x00ffffff-no-rj'
  assert.equal(artworkCandidates(square)[0], square.replace('=s120', '=s1200'))
})

test('YouTube video image retries SD before accepting a small thumb', () => {
  const small = 'https://i.ytimg.com/vi/aBcDe123456/hqdefault.jpg'
  assert.deepEqual(artworkCandidates(small), [
    'https://i.ytimg.com/vi/aBcDe123456/maxresdefault.jpg',
    'https://i.ytimg.com/vi/aBcDe123456/sddefault.jpg',
    small,
  ])
})

test('unknown/signed CDN URLs never have their queries rewritten', () => {
  const signed = 'https://cdn.example.test/track.jpg?token=short-lived'
  assert.deepEqual(artworkCandidates(signed), [signed])
  assert.deepEqual(artworkCandidates('/local/art.jpg'), ['/local/art.jpg'])
})

test('local art stays local: no spurious network upgrades', () => {
  assert.deepEqual(artworkCandidates('file:///home/user/cover.jpg'), ['file:///home/user/cover.jpg'])
})
