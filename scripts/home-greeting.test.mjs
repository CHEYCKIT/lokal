import test from 'node:test'
import assert from 'node:assert/strict'
import { personalizedHomeGreeting, personalizedHomeHeadline, personalizedHomeMessages } from '../src/homeGreeting.mjs'

const now = new Date('2026-10-19T12:00:00').getTime()

function rows(count, { genre = '', playedHour = 12, sameTrack = false, artistCount = count } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now)
    date.setDate(date.getDate() - Math.floor(index * 7 / count) - 1)
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

// Explicit day offsets keep the fixture's active-date count controlled, rather
// than accidentally turning the streak/diversity cases into a different branch.
function rowsOnDays(dayOffsets, { genre = '', playedHour = 11, artistCount = dayOffsets.length } = {}) {
  return dayOffsets.map((daysAgo, index) => {
    const date = new Date(now)
    date.setDate(date.getDate() - daysAgo)
    date.setHours(playedHour, 0, 0, 0)
    const artistIndex = index % Math.max(1, artistCount)
    return {
      id: `dated-track-${index}`,
      title: `Private dated track ${index}`,
      artist: `Private dated artist ${artistIndex}`,
      genre,
      played_at: Math.floor(date.getTime() / 1000),
    }
  })
}

test('uses time-of-day fallback when there is not enough listening history', () => {
  assert.equal(personalizedHomeGreeting([], { hour: 9, now }), 'Ready for a fresh soundtrack?')
  assert.equal(personalizedHomeGreeting([], { hour: 23, now }), 'Keeping the late hours company?')
})

test('uses a concise time-of-day headline when listening history is too short', () => {
  assert.equal(personalizedHomeHeadline([], { hour: 9, now }), 'Good morning')
  assert.equal(personalizedHomeHeadline([], { hour: 14, now }), 'Good afternoon')
  assert.equal(personalizedHomeHeadline([], { hour: 20, now }), 'Good evening')
})

test('pairs a concise repeat headline with the detailed repeat subheader', () => {
  const history = rows(8, { sameTrack: true, artistCount: 1 })
  assert.equal(personalizedHomeHeadline(history, { hour: 12, now }), 'On repeat')
  assert.equal(personalizedHomeGreeting(history, { hour: 12, now }), 'The repeat button has been getting a workout.')
})

test('returns the personalized headline and subheader as one consistent pair for every Home tab', () => {
  const history = rows(8, { sameTrack: true, artistCount: 1 })
  assert.deepEqual(personalizedHomeMessages(history, { hour: 12, now }), {
    headline: 'On repeat',
    subheader: 'The repeat button has been getting a workout.',
  })
  assert.deepEqual(personalizedHomeMessages([], { hour: 9, now }), {
    headline: 'Good morning',
    subheader: 'Ready for a fresh soundtrack?',
  })
})


test('uses short headlines for other listening patterns', () => {
  assert.equal(personalizedHomeHeadline(rows(12, { genre: 'Ambient', artistCount: 10 }), { hour: 12, now }), 'Taking it easy')
  assert.equal(personalizedHomeHeadline(rows(12, { genre: 'Techno', artistCount: 10 }), { hour: 12, now }), 'High energy')
  assert.equal(personalizedHomeHeadline(rows(10, { playedHour: 23, artistCount: 10 }), { hour: 12, now }), 'Night owl')
  assert.equal(personalizedHomeHeadline(rowsOnDays([1, 2, 3, 4, 5, 6, 6, 6], { playedHour: 6, artistCount: 8 }), { hour: 12, now }), 'Early bird')
  assert.equal(personalizedHomeHeadline(rowsOnDays([1, 1, 3, 3, 5, 5, 6, 6], { playedHour: 11, artistCount: 3 }), { hour: 12, now }), 'In a groove')
  assert.equal(personalizedHomeHeadline(rowsOnDays(Array(10).fill(1), { playedHour: 11, artistCount: 10 }), { hour: 12, now }), 'Wide rotation')
})

test('recognizes a repeated-track listening pattern without exposing its metadata', () => {
  const message = personalizedHomeGreeting(rows(8, { sameTrack: true, artistCount: 1 }), { hour: 12, now })
  assert.equal(message, 'The repeat button has been getting a workout.')
  assert.ok(!message.includes('Private track'))
  assert.ok(!message.includes('Private artist'))
})

test('does not let older repeats dominate the message when recent listens are varied', () => {
  const history = rows(20, { artistCount: 20 }).map((entry, index) => ({
    ...entry,
    id: index < 8 ? `recent-track-${index}` : 'same-old-track',
  }))
  assert.notEqual(personalizedHomeGreeting(history, { hour: 12, now }), 'The repeat button has been getting a workout.')
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

test('uses the five-valid-entry threshold before choosing a listening pattern', () => {
  const four = rows(4, { sameTrack: true, artistCount: 1 })
  const five = rows(5, { sameTrack: true, artistCount: 1 })
  assert.equal(personalizedHomeGreeting(four, { hour: 12, now }), 'What sounds good this afternoon?')
  assert.equal(personalizedHomeGreeting(five, { hour: 12, now }), 'The repeat button has been getting a workout.')
})

test('recognizes early-morning listening without triggering other patterns', () => {
  const history = rowsOnDays([1, 2, 3, 4, 5, 6, 6, 6], { playedHour: 6, artistCount: 8 })
  assert.equal(personalizedHomeGreeting(history, { hour: 12, now }), 'You have a soundtrack for the early hours.')
})

test('uses distinct recent active dates rather than raw play count for a listening streak', () => {
  const threeDates = rowsOnDays([1, 1, 1, 3, 3, 3, 5, 5], { playedHour: 11, artistCount: 3 })
  assert.equal(personalizedHomeGreeting(threeDates, { hour: 12, now }), 'What sounds good this afternoon?')

  const fourDates = rowsOnDays([1, 1, 3, 3, 5, 5, 6, 6], { playedHour: 11, artistCount: 3 })
  assert.equal(personalizedHomeGreeting(fourDates, { hour: 12, now }), 'Your listening streak has some momentum.')
})

test('recognizes diverse artists when higher-priority patterns are absent', () => {
  const history = rowsOnDays(Array(10).fill(1), { playedHour: 11, artistCount: 10 })
  assert.equal(personalizedHomeGreeting(history, { hour: 12, now }), 'Lots of different sounds in your rotation lately.')
})
