import test from 'node:test'
import assert from 'node:assert/strict'
import { pickFlow, moodScore, familiarity, genreWeight, topGenres, trackGenres, normalizeTuner, flowSongKey, flowEligible, isFresh, playsOf } from '../src/flow/engine.js'

// A seeded random, so picks are the same each run.
function seeded(seed = 1) {
  let state = seed
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296 }
}

const NOW = 1_800_000_000
const song = (id, over = {}) => ({ id: `t${id}`, title: `Song ${id}`, artist: `Artist ${id}`, play_count: 0, recent_plays: 0, is_liked: 0, ...over })

test('genres are read from both fields, once each', () => {
  assert.deepEqual(trackGenres({ genre: 'Hip-Hop', genres: 'hip-hop, Trap; Rap' }), ['hip-hop', 'trap', 'rap'])
  assert.deepEqual(topGenres([{ genre: 'Rock' }, { genre: 'Pop', is_liked: 1 }, { genre: 'Rock' }, { genre: 'Jazz' }], 2), ['pop', 'rock'])
})

test('moods score on audio features, else on genres', () => {
  const banger = { energy: 0.92, danceability: 0.8, valence: 0.7, tempo: 132 }
  const lullaby = { energy: 0.15, acousticness: 0.9, valence: 0.35, tempo: 78 }
  assert.ok(moodScore(banger, 'workout') > 0.8)
  assert.ok(moodScore(lullaby, 'workout') < 0.4)
  assert.ok(moodScore(lullaby, 'chill') > 0.7)
  assert.ok(moodScore(banger, 'chill') < 0.4)
  assert.ok(moodScore({ valence: 0.1, energy: 0.2, mode: 0 }, 'melancholy') > 0.8)
  assert.ok(moodScore({ instrumentalness: 0.9, speechiness: 0.03, energy: 0.35 }, 'focus') > 0.8)
  assert.equal(moodScore({ genre: 'Lo-Fi' }, 'chill'), 0.75)
  assert.equal(moodScore({ genre: 'Metal' }, 'chill'), 0.25)
  assert.equal(moodScore({}, 'chill'), 0.4)
  assert.equal(moodScore(banger, 'flow'), 1)
})

test('favourites lean all-time or recent as tuned', () => {
  const classic = song(1, { play_count: 200, recent_plays: 0, is_liked: 1, liked_at: NOW - 900 * 86400 })
  const lately = song(2, { play_count: 6, recent_plays: 6 })
  const scale = { maxPlays: 200, maxRecent: 6, now: NOW }
  assert.ok(familiarity(classic, { ...scale, recent: 0 }) > familiarity(lately, { ...scale, recent: 0 }))
  assert.ok(familiarity(lately, { ...scale, recent: 1 }) > familiarity(classic, { ...scale, recent: 1 }))
})

test('the tuner leaves genres out or adds more of them', () => {
  assert.equal(genreWeight({ genre: 'Rock' }, { rock: false }), 0)
  assert.equal(genreWeight({ genre: 'Rock, Pop' }, { rock: false }), 1) // still pop
  assert.equal(genreWeight({ genre: 'Indie Rock' }, { rock: true }), 1.8)
  assert.equal(genreWeight({}, { rock: false }), 1) // no genre known: kept
  assert.deepEqual(normalizeTuner({ adventurous: 4, recent: 'x', genres: { ' Rock ': false, pop: 'yes' } }), { adventurous: 1, recent: 0.4, genres: { rock: false } })
})

test('a flow mixes favourites and fresh finds, never repeats, and spaces artists', () => {
  const favourites = Array.from({ length: 30 }, (_, i) => song(i, { play_count: 10 + i, is_liked: i % 2, artist: `Fav ${i % 5}` }))
  const fresh = Array.from({ length: 30 }, (_, i) => song(100 + i, { artist: `New ${i % 6}` }))
  const pool = [...favourites, ...fresh]
  const safe = pickFlow(pool, { count: 20, tuner: { adventurous: 0, recent: 0.4, genres: {} }, random: seeded(3), now: NOW })
  const bold = pickFlow(pool, { count: 20, tuner: { adventurous: 1, recent: 0.4, genres: {} }, random: seeded(3), now: NOW })
  const freshCount = list => list.filter(track => track.id.startsWith('t1') && Number(track.id.slice(1)) >= 100).length
  assert.equal(safe.length, 20)
  assert.ok(freshCount(safe) <= 3, `cautious: ${freshCount(safe)} fresh`)
  assert.ok(freshCount(bold) >= 12, `adventurous: ${freshCount(bold)} fresh`)
  for (const list of [safe, bold]) {
    assert.equal(new Set(list.map(flowSongKey)).size, list.length)
    for (let i = 1; i < list.length; i++) assert.notEqual(list[i].artist, list[i - 1].artist)
  }
  // Already played or queued: left out.
  const next = pickFlow(pool, { count: 50, exclude: new Set(safe.map(flowSongKey)), random: seeded(4), now: NOW })
  assert.ok(next.every(track => !safe.some(old => old.id === track.id)))
})

test('a mood keeps to the songs that fit it', () => {
  const pool = [
    song(1, { energy: 0.95, danceability: 0.85, tempo: 140, play_count: 5 }),
    song(2, { energy: 0.1, acousticness: 0.9, tempo: 70, play_count: 50 }),
    song(3, { genre: 'Drum and Bass' }),
    song(4, { genre: 'Ambient', play_count: 9 }),
  ]
  const picks = pickFlow(pool, { count: 10, mood: 'workout', random: seeded(2), now: NOW })
  assert.deepEqual(picks.map(track => track.id).sort(), ['t1', 't3'])
})

test("the pool: the library's playable songs with likes and recent plays", async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { createRequire } = await import('node:module')
  const { flowPool } = createRequire(import.meta.url)('../electron/ipc/flow.js')
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT, title TEXT, artist TEXT, play_count INTEGER DEFAULT 0);
    CREATE TABLE user_likes (user_id TEXT, track_id TEXT, liked_at INTEGER, PRIMARY KEY (user_id, track_id));
    CREATE TABLE play_history (id INTEGER PRIMARY KEY, user_id TEXT, track_id TEXT, seconds_played INTEGER DEFAULT 0, played_at INTEGER);`)
  const add = db.prepare('INSERT INTO tracks (id, file_path, title, artist, play_count) VALUES (?, ?, ?, ?, ?)')
  add.run('liked', '/a.flac', 'A', 'X', 0)
  add.run('played', '/b.flac', 'B', 'X', 4)
  add.run('new', '/c.flac', 'C', 'Y', 0)
  add.run('ghost', 'ghost://d', 'D', 'Y', 9)
  add.run('broken', '/e.flac', 'E', 'Y', 3)
  db.prepare('INSERT INTO user_likes VALUES (?, ?, ?)').run('u1', 'liked', 100)
  db.prepare('INSERT INTO user_likes VALUES (?, ?, ?)').run('u2', 'new', 100) // another user's like
  const now = Math.floor(Date.now() / 1000)
  const play = db.prepare('INSERT INTO play_history (user_id, track_id, seconds_played, played_at) VALUES (?, ?, ?, ?)')
  play.run('u1', 'played', 200, now - 3600)
  play.run('u1', 'played', 0, now - 90 * 86400) // from before listens were timed
  play.run('u1', 'new', 5, now - 60) // a skip: not a play
  play.run('u2', 'new', 200, now - 60) // another profile's play
  db.exec("CREATE TABLE track_errors (track_id TEXT PRIMARY KEY, message TEXT NOT NULL, at INTEGER NOT NULL); INSERT INTO track_errors VALUES ('broken', 'gone', 1)")
  const rows = Object.fromEntries(flowPool(db, 'u1').map(row => [row.id, row]))
  assert.deepEqual(Object.keys(rows).sort(), ['liked', 'new', 'played'])
  assert.equal(rows.liked.is_liked, 1)
  assert.equal(rows.new.is_liked, 0)
  assert.equal(rows.played.recent_plays, 1)
  assert.equal(rows.played.user_plays, 2)
  // Another profile's plays (and this one's skips) don't make it a favourite here.
  assert.equal(rows.new.user_plays, 0)
  assert.equal(rows.broken, undefined)
  assert.equal(isFresh(rows.new), true)
  assert.equal(isFresh(rows.played), false)
})

test('Flow counts the listener\'s own plays, not the library-wide count', () => {
  assert.equal(playsOf({ play_count: 40, user_plays: 0 }), 0)
  assert.equal(playsOf({ play_count: 40 }), 40) // no per-user count (an older pool): the shared one
  assert.equal(isFresh({ play_count: 40, user_plays: 0 }), true)
})

test('how many songs a mood and tuner can play', () => {
  const pool = [song(1, { genre: 'Rock', energy: 0.9, danceability: 0.8, tempo: 135 }), song(2, { genre: 'Jazz', energy: 0.1, tempo: 70 }), song(3, { genre: 'Rock', energy: 0.95, tempo: 140 })]
  assert.equal(flowEligible(pool), 3)
  assert.equal(flowEligible(pool, { mood: 'workout' }), 2)
  assert.equal(flowEligible(pool, { tuner: { genres: { rock: false } } }), 1)
})
