import test from 'node:test'
import assert from 'node:assert/strict'
import { personalizedHomeGreeting } from '../src/homeGreeting.mjs'

const now = new Date('2026-10-19T12:00:00').getTime()

function rows(count, { genre = '', playedHour = 12, dayOffset = 0, sameTrack = false, artistCount = count } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now)
    date.setDate(date.getDate() - Math.floor(index / Math.max(1, count / (dayOffset + 1))))
    date.setHours(playedHour, 0, 0, 0)
    const artistIndex = index % Math.max(1, artistCount)
    return {
      id: sameTrack ? 'same-id' : `track-${index}`,
      title: `Private track name ${index}`,
      artist: `Private artist name ${artistIndex}`,
      genre,
      played_at: Math.floor(date.getTime() / 1000),
    }
  })
}

test('uses time-of-day fallback when there is not enough listening history', () => {
  assert.equal(personalizedHomeGreeting([], { hour: 9, now }), 'Ready for a fresh soundtrack?')
  assert.equal(personalizedHomeGreeting([], { hour: 23, now }), 'Keeping the late hours company?')
})

test('recognizes a repeated-track listening pattern without exposing its metadata', () => {
  const message = personalizedHomeGreeting(rows(8, { sameTrack: true, artistCount: 1 }), { hour: 12, now })
  assert.equal(message, 'The repeat button has been getting a workout.')
  assert.ok(!message.includes('Private track'))
  assert.ok(!message.includes('Private artist'))
})

test('recognizes a dominant mellow listening profile without naming genres', () => {
  assert.equal(personalizedHomeGreeting(rows(12, { genre: 'Ambient', artistCount: 10 }), { hour: 12, now }),
    'Your mellow side has been getting more play.')
})

test('recognizes a high-energy listening profile without naming genres', () => {
  assert.equal(personalizedHomeGreeting(rows(12, { genre: 'Techno', artistCount: 10 }), { hour: 12, now }),
    'High-energy listening has been winning lately.')
})

test('recognizes late-night listening habits without naming tracks or artists', () => {
  assert.equal(personalizedHomeGreeting(rows(10, { playedHour: 23, artistCount: 10 }), { hour: 12, now }),
    'Your after-dark listening rhythm is holding steady.')
})
