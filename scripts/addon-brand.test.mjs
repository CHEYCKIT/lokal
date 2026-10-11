import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { addonIcon, brandOf } = require('../electron/online/addonBrand.js')
const addons = require('../electron/online/addons.js')

test('an addon without an icon gets its service\'s logo, matched by name, id or host', () => {
  assert.equal(brandOf({ name: 'Qobuz' }), 'qobuz')
  assert.equal(brandOf({ name: 'Spotify Web' }), 'spotify')
  assert.equal(brandOf({ name: 'YouTube Music' }), 'youtube-music')
  assert.equal(brandOf({ name: 'YouTube' }), 'youtube')
  assert.equal(brandOf({ name: 'Apple Music' }), 'apple-music')
  assert.equal(brandOf({ name: 'Lossless', host: 'qobuz-addon.vercel.app' }), 'qobuz')
  assert.equal(brandOf({ name: 'Lossless Mirror' }), null)
  for (const name of ['Deezer', 'Tidal', 'Qobuz', 'Spotify Web', 'Apple Music', 'YouTube Music', 'SoundCloud']) assert.match(addonIcon({ name }), /^data:image\/svg\+xml;utf8,/, name)
  // The logo in the service's colour, on a clear background.
  const tidal = decodeURIComponent(addonIcon({ name: 'Tidal' }))
  assert.match(tidal, /<path fill="#ffffff" d="M12\.012 3\.992/)
  assert.doesNotMatch(tidal, /<rect/)
  assert.match(decodeURIComponent(addonIcon({ name: 'Spotify Web' })), /fill="#1ed760"/)
  // Anyone else keeps the generic addon icon.
  assert.equal(addonIcon({ name: 'Lossless Mirror' }), null)
  assert.equal(addonIcon({ name: 'Ultramax' }), null)
})

test('an installed addon without an icon is listed with one; its own icon is kept', async () => {
  const rows = new Map()
  const db = { prepare: () => ({ get: key => (rows.has(key) ? { value: rows.get(key) } : undefined), run: (key, value) => { rows.set(key, value) }, all: () => [] }) }
  const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  await addons.install(db, 'https://qobuz-addon.example/manifest.json', { fetchImpl: async () => json({ id: 'com.example.qobuz', name: 'Qobuz', version: '1.0.0', resources: ['search', 'stream'] }) })
  await addons.install(db, 'https://other.example/manifest.json', { fetchImpl: async () => json({ id: 'other', name: 'Other', version: '1', icon: 'https://other.example/icon.png', resources: ['search', 'stream'] }) })
  const listed = addons.list(db)
  assert.match(listed.find(a => a.name === 'Qobuz').icon, /^data:image\/svg\+xml/)
  assert.equal(listed.find(a => a.name === 'Other').icon, 'https://other.example/icon.png')
})
