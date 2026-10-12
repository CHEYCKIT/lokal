import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { fitsMood } = await import('../src/flow/moodFit.js')
const { moodFinds, moodSeeds, resetOnline } = await import('../src/flow/online.js')
const { songKey } = await import('../src/recommendations.js')

const a = (bpm, loudness, beatConfidence = 0.8) => ({ bpm, loudness, beatConfidence })

test('a find is checked against the song it was found from', () => {
  // Chill, from a 90 BPM seed.
  assert.equal(fitsMood({ mood: 'chill', candidate: a(92, -12), seed: a(90, -11) }).fit, true)
  assert.equal(fitsMood({ mood: 'chill', candidate: a(180, -12), seed: a(90, -11) }).fit, true, 'double time is the same pace')
  assert.equal(fitsMood({ mood: 'chill', candidate: a(128, -12), seed: a(90, -11) }).fit, false, 'faster')
  assert.equal(fitsMood({ mood: 'chill', candidate: a(91, -3), seed: a(90, -12) }).fit, false, 'much louder')
  // Workout, from a 128 BPM seed.
  assert.equal(fitsMood({ mood: 'workout', candidate: a(126, -7), seed: a(128, -6) }).fit, true)
  assert.equal(fitsMood({ mood: 'workout', candidate: a(124, -16), seed: a(128, -6) }).fit, false, 'much quieter')
  assert.equal(fitsMood({ mood: 'workout', candidate: a(76, -7), seed: a(128, -6) }).fit, false, 'nowhere near the seed\'s pace, either reading')
  // Without a seed to compare with, a slow reading may be a fast song read at half speed: kept.
  assert.equal(fitsMood({ mood: 'workout', candidate: a(76, -7), seed: null }).fit, true)
  // Nothing to go on: the seed's similarity alone.
  assert.equal(fitsMood({ mood: 'chill', candidate: null, seed: a(90, -11) }).fit, true)
  // A tempo it isn't sure of doesn't count against it.
  assert.equal(fitsMood({ mood: 'chill', candidate: a(150, -12, 0.1), seed: a(90, -11) }).fit, true)
})

test('seeds: the library songs that fit the mood best, favourites first, taking turns', () => {
  resetOnline()
  const pool = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `S${i}`, artist: `A${i}`, fit: i < 10 ? 1 : 0, fav: i / 30 }))
  const options = { mood: 'chill', fits: t => t.fit, favour: t => t.fav, count: 3, random: () => 0 }
  const first = moodSeeds(pool, options)
  assert.equal(first.length, 3)
  assert.ok(first.every(t => t.fit === 1))
  assert.deepEqual(first.map(t => t.id), ['t9', 't8', 't7'], 'favourites first')
  const second = moodSeeds(pool, options)
  assert.ok(second.every(t => !first.includes(t)), 'others next time')
})

test('mood finds: similar to the seeds, heard, and only those that fit', async () => {
  resetOnline()
  const seeds = [{ id: 's1', title: 'Calm', artist: 'Seed' }]
  const client = { lastfmSimilar: async () => ({ tracks: [{ title: 'Slow', artist: 'X' }, { title: 'Banger', artist: 'Y' }, { title: 'Known', artist: 'Z' }] }) }
  const analyses = { Slow: a(88, -12), Banger: a(174, -4), Calm: a(90, -12) }
  const resolve = async rows => rows.map(row => ({ ...row, id: `yt:${row.title}`, file_path: `ghost://youtube/online/${row.title}` }))
  const left = []
  const found = await moodFinds('lastfm', {
    mood: 'chill', seeds, count: 3, client, resolve, random: () => 0,
    exclude: new Set([songKey({ title: 'Known', artist: 'Z' })]),
    analyze: async track => analyses[track.title] || null,
    log: message => left.push(message),
  })
  assert.deepEqual(found.map(t => t.title), ['Slow'])
  assert.equal(found[0].flowSeed, 's1')
  assert.match(left.join('\n'), /Banger/)
})

test('library only, or no seeds: nothing online', async () => {
  assert.deepEqual(await moodFinds('library', { mood: 'chill', seeds: [{}], count: 2 }), [])
  assert.deepEqual(await moodFinds('lastfm', { mood: 'chill', seeds: [], count: 2 }), [])
})

test('mood finds: a reset while one is being heard returns nothing', async () => {
  resetOnline()
  const seeds = [1, 2, 3].map(n => ({ id: `s${n}`, title: `Seed ${n}`, artist: 'Seed' }))
  const client = { lastfmSimilar: async (artist, title) => ({ tracks: Array.from({ length: 30 }, (_, i) => ({ title: `${title} like ${i}`, artist: 'X' })) }) }
  const resolve = async rows => rows.map(row => ({ ...row, id: `yt:${row.title}`, file_path: `ghost://youtube/online/${row.title}` }))
  let analysed = 0
  const analyze = async () => { analysed++; return a(90, -12) }
  const found = await moodFinds('lastfm', { mood: 'chill', seeds, count: 1, client, resolve, analyze, random: () => 0 })
  assert.equal(found.length, 1)
  // Reset while the next one is being heard: nothing comes back.
  const stale = await moodFinds('lastfm', { mood: 'chill', seeds, count: 2, client, resolve, random: () => 0, analyze: async () => { resetOnline(); return a(90, -12) } })
  assert.deepEqual(stale, [])
  assert.ok(analysed >= 1)
})
