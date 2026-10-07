import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRecommendationMix, loadRecommendationPage, playbackFallbackMessage, matchCover, recommendationMatch, recommendationQueries, resolveRecommendationTracks, songKey } from '../src/recommendations.js'
import { orderedPlaybackSources } from '../src/playbackSources.js'
import { buildRadio } from '../src/radioActions.js'

const song = i => ({ title: `Song ${i}`, artist: `Artist ${i}` })
const playable = item => ({ ...item, id: `${item.artist}-${item.title}`, file_path: '/music/song.flac' })
const songs = (count, offset = 0) => Array.from({ length: count }, (_, i) => song(i + offset))
const addon = 'a-0123456789'

function clientMock(overrides = {}) {
  const searches = []
  const saved = []
  const client = {
    getSettings: async () => ({ playback_search_order: JSON.stringify(['sc', addon, 'yt']) }),
    onlineProviders: async () => [{ id: 'yt' }, { id: 'sc' }, { id: addon, addon: true }],
    searchTracks: async () => [],
    onlineSearch: async (query, source) => { searches.push(source); return { results: [{ ...song(1), id: 'abcdefghijk', provider: source }] } },
    onlineSave: async items => { saved.push(...items); return items.map(item => ({ ...item, id: `${item.provider}-${item.id}`, file_path: item.provider === 'sc' ? 'ghost://soundcloud/online/123' : item.provider === addon ? 'ghost://addon/0123456789/item' : 'ghost://youtube/online/abcdefghijk' })) },
    onlinePrepare: async () => ({ ok: true, preview: false }),
    ...overrides,
  }
  return { client, searches, saved }
}

test('saved priority excludes removed addons and includes newly available providers once', () => {
  assert.deepEqual(orderedPlaybackSources(JSON.stringify(['sc', 'removed', 'sc']), [{ id: 'yt' }, { id: 'sc' }, { id: addon }]).map(p => p.id), ['sc', 'yt', addon])
  assert.deepEqual(orderedPlaybackSources('bad json').map(p => p.id), ['yt', 'sc'])
})

test('matching requires the exact title and artist and preserves version differences', () => {
  const target = { title: 'Song', artist: 'Artist' }
  for (const result of [{ title: 'Song', artist: 'Cover Artist' }, { title: 'Song (Live)', artist: 'Artist' }, { title: 'Other Song', artist: 'Artist' }]) {
    assert.equal(recommendationMatch(target, [result]), null)
  }
  assert.ok(recommendationMatch(target, [{ title: 'Song (Official Audio)', artist: 'Artist - Topic' }]))
})

test('Travis Scott artist playback searches artist plus title and matches featured credits without accepting other versions', async () => {
  const target = { title: 'FE!N', artist: 'Travis Scott' }
  const actual = { title: 'FE!N (feat. Playboi Carti)', artist: 'Travis Scott', artists: ['Travis Scott'], videoId: '2nR1zrNzgcY', id: '2nR1zrNzgcY' }
  assert.equal(recommendationMatch(target, [actual]), actual)
  for (const title of ['FE!N (CHASE B REMIX)', 'FE!N (Live)', 'FE!N (Cover)']) assert.equal(recommendationMatch(target, [{ ...actual, title }]), null)
  const queries = [], progress = []
  const { client } = clientMock({
    getSettings: async () => ({ playback_search_order: '["yt"]' }), onlineProviders: async () => [{ id: 'yt' }],
    onlineSearch: async (query, source) => { queries.push([query, source]); return { results: [actual] } },
  })
  assert.equal((await resolveRecommendationTracks([target], client, { onProgress: message => progress.push(message) })).length, 1)
  assert.deepEqual(queries, [['Travis Scott FE!N', 'yt']])
  assert.ok(progress.some(message => message.includes('Travis Scott') && message.includes('FE!N')))
})

test('a native artist song ID avoids a redundant search and preparation failures retain their real cause', async () => {
  const failures = [], prepared = []
  const { client } = clientMock({
    getSettings: async () => ({ playback_search_order: '["yt"]' }), onlineProviders: async () => [{ id: 'yt' }],
    onlineSearch: async () => { throw new Error('Native song IDs must not be searched again') },
    onlinePrepare: async (source, id) => { prepared.push([source, id]); return { error: 'yt-dlp is not installed. Install it from the Download page.' } },
  })
  const result = await resolveRecommendationTracks([{ title: 'SICKO MODE', artist: 'Travis Scott', videoId: 'NQbkGDoD7B0' }], client, { onProviderFailure: failure => failures.push(failure) })
  assert.deepEqual(result, [])
  assert.deepEqual(prepared, [['yt', 'NQbkGDoD7B0']])
  assert.equal(failures[0].reason, 'unavailable', 'a found song with a failed stream is not a missing search result')
  assert.match(playbackFallbackMessage(failures[0]), /yt-dlp is not installed/)
})

test('native YouTube identity survives a database-only save row and a subsequent SoundCloud fallback', async () => {
  const target = { title: 'Native Song', artist: 'Artist A, Artist B', artists: ['Artist A', 'Artist B'], videoId: 'abcdefghijk', source: 'youtube' }
  const prepared = [], searches = []
  const { client } = clientMock({
    getSettings: async () => ({ playback_search_order: '["sc","yt"]' }), onlineProviders: async () => [{ id: 'sc' }, { id: 'yt' }],
    onlineSearch: async (query, source) => { searches.push(source); return source === 'sc' ? { results: [{ id: '123', ...target, artist: 'Artist A', artists: ['Artist A'] }] } : { results: [] } },
    onlineSave: async items => items.map(item => ({ id: `${item.provider}-${item.id}`, file_path: item.provider === 'sc' ? 'ghost://soundcloud/online/123' : `ghost://youtube/online/${item.id}`, source_url: item.provider === 'sc' ? 'https://api.soundcloud.com/tracks/123' : `https://music.youtube.com/watch?v=${item.id}`, title: item.title, artist: item.artist })),
    onlinePrepare: async (source, id) => { prepared.push([source, id]); return { ok: true } },
  })
  const [saved] = await resolveRecommendationTracks([target], client)
  assert.equal(saved.videoId, target.videoId)
  assert.deepEqual(saved.artists, target.artists)
  const [fallback] = await resolveRecommendationTracks([saved], client, { reusePlayable: false, afterProvider: 'sc' })
  assert.equal(fallback.file_path, 'ghost://youtube/online/abcdefghijk')
  assert.deepEqual(searches, ['sc'], 'the known YouTube recording must not be searched by display title again')
  assert.deepEqual(prepared.at(-1), ['yt', 'abcdefghijk'])
})

test('existing YouTube ghosts, downloaded source identities and native URLs resolve directly without text search', async () => {
  for (const identity of [{ file_path: 'ghost://youtube/online/abcdefghijk', id: 'yt-abcdefghijk' }, { source_ref: 'yt:abcdefghijk' }, { url: 'https://music.youtube.com/watch?v=abcdefghijk' }, { source_url: 'https://youtu.be/abcdefghijk' }]) {
    const prepared = []
    const { client } = clientMock({ getSettings: async () => ({ playback_search_order: '["yt"]' }), onlineProviders: async () => [{ id: 'yt' }], onlineSearch: async () => { throw new Error('Native identity should avoid text search') }, onlinePrepare: async (source, id) => { prepared.push(id); return { ok: true } } })
    const resolved = await resolveRecommendationTracks([{ ...song(1), ...identity }], client, { reusePlayable: false })
    assert.equal(resolved.length, 1)
    assert.deepEqual(prepared, ['abcdefghijk'])
  }
})

test('collaborative tracks match their structured lead artist while wrong artists and alternate versions remain rejected', () => {
  const candidate = { title: 'Collaboration', artist: 'Artist A, Artist B', artists: ['Artist A', 'Artist B'] }
  assert.ok(recommendationMatch(candidate, [{ title: 'Collaboration', artist: 'Artist A', artists: ['Artist A'] }]))
  for (const result of [{ title: 'Collaboration', artist: 'Artist B' }, { title: 'Collaboration', artist: 'Other Artist' }, { title: 'Collaboration (Live)', artist: 'Artist A' }]) assert.equal(recommendationMatch(candidate, [result]), null)
})

test('featured credits cannot conceal remix, live, or cover versions in matching', () => {
  const target = { title: 'FE!N', artist: 'Travis Scott' }
  for (const suffix of ['(feat. Playboi Carti - Remix)', '[ft. Playboi Carti - LIVE]', '(featuring Playboi Carti - Cover)', 'feat. Playboi Carti - Remix', 'ft. Playboi Carti (Live)', 'featuring Playboi Carti - Cover']) {
    const result = { ...target, title: `FE!N ${suffix}` }
    assert.equal(recommendationMatch(target, [result]), null, suffix)
    assert.equal(recommendationMatch(target, [{ ...result, title: `Travis Scott - ${result.title}` }]), null, `artist-prefixed ${suffix}`)
    assert.equal(recommendationMatch(result, [target]), null, 'a versioned candidate must not collapse to the original either')
    assert.equal(recommendationMatch(result, [result]), result, 'an exact versioned title remains eligible')
  }
  for (const suffix of ['(feat. Playboi Carti)', '[ft. Playboi Carti]', 'featuring Playboi Carti']) {
    const result = { ...target, title: `FE!N ${suffix}` }
    assert.equal(recommendationMatch(target, [result]), result)
  }
})

test('provider error responses are not misreported as missing artist songs', async () => {
  const failures = []
  const { client } = clientMock({ onlineSearch: async () => ({ error: 'Search rejected (401)', results: [] }) })
  assert.deepEqual(await resolveRecommendationTracks([{ title: 'SICKO MODE', artist: 'Travis Scott' }], client, { onProviderFailure: failure => failures.push(failure) }), [])
  assert.equal(failures.length, 3)
  assert.ok(failures.every(failure => failure.reason === 'unavailable' && failure.detail === 'Search rejected (401)'))
  assert.match(playbackFallbackMessage(failures[0]), /Search rejected \(401\)/)
})

test('playback follows SoundCloud/addon/YouTube order and survives a local lookup failure', async () => {
  const { client, searches, saved } = clientMock({
    searchTracks: async () => { throw new Error('Local search unavailable') },
  })
  client.onlineSearch = async (query, provider) => {
    searches.push(provider)
    if (provider === 'sc') throw new Error('Offline')
    return { results: [{ ...song(1), id: 'remote-id', artist: provider === addon ? 'Wrong Artist' : 'Artist 1' }] }
  }
  const result = await resolveRecommendationTracks([song(1)], client)
  assert.deepEqual(searches, ['sc', addon, 'yt'])
  assert.equal(result.length, 1)
  assert.equal(saved[0].provider, 'yt')
})

test('addon matches are saved without assuming the backend row ID format', async () => {
  const { client, searches } = clientMock()
  client.getSettings = async () => ({ playback_search_order: JSON.stringify([addon, 'sc', 'yt']) })
  client.onlineSave = async items => items.map(item => ({ ...item, id: 'hashed-row-id', file_path: 'ghost://addon/0123456789/track' }))
  const result = await resolveRecommendationTracks([song(1)], client)
  assert.deepEqual(searches, [addon])
  assert.equal(result[0].id, 'hashed-row-id')
})

test('ghost placeholders and cached streams do not bypass changed priority', async () => {
  const { client, searches } = clientMock({ searchTracks: async () => [
    { ...song(1), id: 'imported', file_path: 'ghost://spotify/track' },
    { ...song(1), id: 'cached-youtube', file_path: 'ghost://youtube/online/abcdefghijk' },
  ] })
  const result = await resolveRecommendationTracks([song(1)], client)
  assert.deepEqual(searches, ['sc'])
  assert.equal(result[0].provider, 'sc')
})

test('a stalled provider times out and an invalid saved row falls through', async () => {
  const { client, searches } = clientMock()
  client.onlineSearch = async (query, source) => {
    searches.push(source)
    if (source === 'sc') return new Promise(() => {})
    return { results: [{ ...song(1), id: 'abcdefghijk' }] }
  }
  const save = client.onlineSave
  client.onlineSave = items => items[0].provider === addon ? Promise.resolve([{ id: 'unplayable' }]) : save(items)
  const result = await resolveRecommendationTracks([song(1)], client, { timeoutMs: 15 })
  assert.deepEqual(searches, ['sc', addon, 'yt'])
  assert.equal(result.length, 1)
})

for (const previewInSearch of [true, false]) {
  test(`missing YouTube songs skip SoundCloud previews identified in ${previewInSearch ? 'search' : 'stream resolution'} and reach addons`, async () => {
    const failures = []
    const prepared = []
    const { client, searches, saved } = clientMock({
      getSettings: async () => ({ playback_search_order: JSON.stringify(['yt', 'sc', addon]) }),
      onlinePrepare: async provider => { prepared.push(provider); return { ok: true, preview: provider === 'sc' } },
    })
    client.onlineSearch = async (query, provider) => {
      searches.push(provider)
      return { results: provider === 'yt' ? [] : [{ ...song(1), id: '123', preview: provider === 'sc' && previewInSearch }] }
    }
    const result = await resolveRecommendationTracks([song(1)], client, { onProviderFailure: failure => failures.push(failure) })
    assert.deepEqual(searches, ['yt', 'sc', addon])
    assert.deepEqual(saved.map(item => item.provider), [addon], 'preview tracks are never saved as playback matches')
    assert.deepEqual(prepared, previewInSearch ? [addon] : ['sc', addon])
    assert.equal(result[0].provider, addon)
    assert.deepEqual(failures.map(({ source, nextSource, reason }) => [source.id, nextSource?.id, reason]), [['yt', 'sc', 'not-found'], ['sc', addon, 'preview']])
    assert.match(playbackFallbackMessage(failures[0]), /wasn't found on YouTube.*Trying SoundCloud/)
    assert.match(playbackFallbackMessage(failures[1]), /SoundCloud only has a preview.*Trying Addon/)
  })
}

test('a found but unplayable YouTube stream advances to the next full-length source', async () => {
  const failures = []
  const { client, saved } = clientMock({
    getSettings: async () => ({ playback_search_order: JSON.stringify(['yt', 'sc', addon]) }),
    onlinePrepare: async provider => provider === 'yt' ? { error: 'Video unavailable' } : { ok: true },
  })
  const result = await resolveRecommendationTracks([{ ...song(1), videoId: 'abcdefghijk' }], client, { onProviderFailure: failure => failures.push(failure) })
  assert.equal(result[0].provider, 'sc')
  assert.deepEqual(saved.map(item => item.provider), ['sc'])
  assert.equal(failures[0].reason, 'unavailable')
})

test('runtime recovery skips the failed provider and keeps the fallback order', async () => {
  const { client, searches } = clientMock({ getSettings: async () => ({ playback_search_order: JSON.stringify(['yt', 'sc', addon]) }) })
  const failed = { ...song(1), id: 'yt-abcdefghijk', videoId: 'abcdefghijk', file_path: 'ghost://youtube/online/abcdefghijk' }
  const result = await resolveRecommendationTracks([failed], client, { reusePlayable: false, afterProvider: 'yt', skipProviders: ['yt', 'sc'] })
  assert.deepEqual(searches, [addon])
  assert.equal(result[0].provider, addon)
})

test('all unavailable or preview-only providers return no match and report exhaustion', async () => {
  const failures = []
  const { client, saved } = clientMock({ onlinePrepare: async provider => ({ ok: true, preview: provider !== 'yt', error: provider === 'yt' ? 'Unavailable' : undefined }) })
  const result = await resolveRecommendationTracks([song(1)], client, { onProviderFailure: failure => failures.push(failure) })
  assert.deepEqual(result, [])
  assert.deepEqual(saved, [])
  assert.equal(failures.at(-1).nextSource, undefined)
  assert.match(playbackFallbackMessage(failures.at(-1)), /No more playback sources/)
})

test('changing playback while stream preparation is pending prevents stale saves and notifications', async () => {
  let current = true
  const failures = []
  const { client, saved } = clientMock({ onlinePrepare: async () => { current = false; return { ok: true, preview: true } } })
  assert.deepEqual(await resolveRecommendationTracks([song(1)], client, { isCurrent: () => current, onProviderFailure: failure => failures.push(failure) }), [])
  assert.deepEqual(saved, [])
  assert.deepEqual(failures, [])
})

for (const size of [24, 32, 40]) {
  test(`mix contains exactly ${size} unique playable matches across provider pages`, async () => {
    const pages = []
    const mix = await buildRecommendationMix({
      size,
      loadPage: async page => { pages.push(page); return { candidates: songs(24, page * 24) } },
      resolve: async items => items.filter(item => Number(item.title.split(' ')[1]) % 3 !== 0).map(playable),
    })
    assert.equal(mix.length, size)
    assert.equal(new Set(mix.map(songKey)).size, size)
    assert.ok(pages.length > 1)
  })
}

test('regeneration consumes fresh songs before repeats and rejects an unchanged mix', async () => {
  const previous = songs(24).map(playable)
  const mix = await buildRecommendationMix({ size: 24, previous, loadPage: async () => ({ candidates: [...songs(24), ...songs(24, 24)] }), resolve: async items => items.map(playable) })
  assert.ok(mix.every(track => !previous.some(old => songKey(old) === songKey(track))))
  await assert.rejects(buildRecommendationMix({ size: 24, previous, loadPage: async () => ({ candidates: songs(24) }), resolve: async items => items.map(playable) }), /same songs/)
})

test('insufficient matches and cancellation reject without mutating the previous mix', async () => {
  const previous = songs(24).map(playable)
  const original = structuredClone(previous)
  await assert.rejects(buildRecommendationMix({ size: 40, previous, loadPage: async () => ({ candidates: songs(10, 100) }), resolve: async items => items.map(playable) }), /Found 10 playable matches for 40/)
  assert.deepEqual(previous, original)
  let current = true
  await assert.rejects(buildRecommendationMix({ size: 24, isCurrent: () => current, loadPage: async () => { current = false; return { candidates: songs(40) } } }), /superseded/)
})

test('provider refresh passes the Last.fm page and forces YouTube account refresh', async () => {
  const pages = []
  const forced = []
  const playlists = []
  const client = {
    lastfmDiscovery: async page => { pages.push(page); return { candidates: [] } },
    youtubeAccount: async force => { forced.push(force); return { home: [], homePlaylists: ['a', 'b', 'c'].map(id => ({ id })) } },
    youtubeAccountPlaylist: async id => { playlists.push(id); return { tracks: [song(id)] } },
  }
  await loadRecommendationPage('lastfm', 3, client)
  await loadRecommendationPage('youtube', 2, client)
  assert.deepEqual(pages, [3])
  assert.deepEqual(forced, [true])
  assert.deepEqual(playlists, ['b', 'c'])
})

test('YouTube shelves keep the thirty most recent likes, all genuine mixes, and history album metadata', async () => {
  const likes = songs(40).map((track, i) => ({ ...track, videoId: `video${i}`, thumbnail: `https://images.example/${i}` }))
  const mixes = Array.from({ length: 18 }, (_, i) => ({ id: `RDmix${i}`, title: `Mix ${i}`, thumbnail: `https://images.example/mix${i}` }))
  const result = await loadRecommendationPage('youtube', 0, { youtubeAccount: async () => ({ liked: likes, mixes, history: [{ ...song(1), album: 'History Album', albumId: 'MPREalbum' }] }) })
  assert.deepEqual(result.liked.map(track => track.title), likes.slice(0, 30).map(track => track.title))
  assert.deepEqual(result.mixes.map(mix => mix.id), mixes.map(mix => mix.id))
  assert.equal(result.mixes.at(-1).artwork_url, mixes.at(-1).thumbnail)
  assert.equal(result.history[0].album, 'History Album')
  assert.equal(result.history[0].albumId, 'MPREalbum')
})

test('local-track radio and Last.fm candidates use configured playback sources', async () => {
  const { client, searches } = clientMock({ lastfmSimilar: async () => ({ tracks: [song(1)] }) })
  const result = await buildRadio(playable(song(1)), 'guest', client)
  assert.deepEqual(searches, ['yt', 'sc'])
  assert.equal(result.length, 1, 'seed and matching provider song are deduplicated')
})

test('artist radio uses provider priority and rejects a similarly named wrong artist', async () => {
  const { client, searches } = clientMock({ lastfmSimilar: async () => ({ artists: [{ name: 'Artist 1' }] }) })
  client.onlineSearch = async (query, source) => {
    searches.push(source)
    return { results: [{ ...song(1), id: 'track', artist: source === 'sc' ? 'Artist 10' : 'Artist 1' }] }
  }
  const result = await buildRadio({ artist: 'Seed Artist', type: 'artist' }, 'guest', client)
  assert.deepEqual(searches, ['sc', addon])
  assert.equal(result.length, 1)
  assert.equal(result[0].provider, addon)
})

test('one failed artist-radio preparation does not discard another playable match from the same provider', async () => {
  const { client, searches } = clientMock({
    lastfmSimilar: async () => ({ artists: [{ name: 'Artist 1' }] }),
    onlinePrepare: async (provider, id) => { if (id === 'failed') throw new Error('Unavailable'); return { ok: true } },
  })
  client.onlineSearch = async (query, source) => {
    searches.push(source)
    return { results: [{ ...song(1), id: 'failed' }, { ...song(1), title: 'Song 2', id: 'playable' }] }
  }
  const result = await buildRadio({ artist: 'Seed Artist', type: 'artist' }, 'guest', client)
  assert.deepEqual(searches, ['sc'])
  assert.deepEqual(result.map(track => track.title), ['Song 2'])
  assert.equal(result[0].provider, 'sc')
})

test('SoundCloud-first playback retains YouTube radio recommendations', async () => {
  const radioIds = []
  const { client, searches } = clientMock({
    youtubeRadio: async id => { radioIds.push(id); return [song(1)] },
    lastfmSimilar: async () => ({ tracks: [] }),
  })
  const result = await buildRadio(playable(song(1)), 'guest', client)
  assert.deepEqual(radioIds, ['abcdefghijk'])
  assert.deepEqual(searches, ['yt', 'sc'])
  assert.equal(result.length, 1)
})

test('downloaded YouTube identity avoids a seed search with SoundCloud-first playback', async () => {
  const radioIds = []
  const { client, searches } = clientMock({
    youtubeRadio: async id => { radioIds.push(id); return [song(1)] },
    lastfmSimilar: async () => ({ tracks: [] }),
  })
  const result = await buildRadio({ ...playable(song(0)), source_ref: 'yt:abcdefghijk' }, 'guest', client)
  assert.deepEqual(radioIds, ['abcdefghijk'])
  assert.deepEqual(searches, ['sc'])
  assert.equal(result[1].provider, 'sc')
})

test('remastered and single versions are the same song; live, remix and edit are not', () => {
  const song = { title: 'September', artist: 'Earth, Wind & Fire' }
  const as = title => recommendationMatch(song, [{ title, artist: 'Earth, Wind & Fire' }])
  for (const title of ['September - Remastered 2003', 'September (2011 Remaster)', 'September (Remastered)', 'September - 2003 Remaster', 'September - Single Version', 'September (Mono)']) assert.ok(as(title), title)
  for (const title of ['September (Live)', 'September - Remix', 'September (Edit)']) assert.equal(as(title), null, title)
  assert.ok(recommendationMatch({ title: 'September - Remastered 2003', artist: 'Earth, Wind & Fire' }, [song]))
})

test('the same album\'s copy of a song is preferred, and its cover kept', () => {
  const picked = { title: 'Boogie Wonderland', artist: 'Earth, Wind & Fire', album: 'I Am', artwork_url: 'https://lastfm.example/i-am.jpg' }
  const results = [
    { title: 'Boogie Wonderland', artist: 'Earth, Wind & Fire', album: 'The Essential Earth, Wind & Fire', thumbnail: 'https://addon.example/essential.jpg' },
    { title: 'Boogie Wonderland (with The Emotions)(Album Version)', artist: 'Earth, Wind & Fire', album: 'I Am', thumbnail: 'https://addon.example/i-am.jpg' },
  ]
  const match = recommendationMatch(picked, results)
  assert.equal(match.album, 'I Am')
  assert.equal(matchCover(picked, match), 'https://addon.example/i-am.jpg')
  // Only the compilation's copy: it's saved with the cover that was shown.
  assert.equal(matchCover(picked, recommendationMatch(picked, results.slice(0, 1))), 'https://lastfm.example/i-am.jpg')
  // Nothing better to go on: the match's own cover.
  assert.equal(matchCover({ ...picked, album: '' }, results[0]), 'https://addon.example/essential.jpg')
  assert.equal(matchCover({ ...picked, artwork_url: 'http://insecure.example/a.jpg' }, results[0]), 'https://addon.example/essential.jpg')
  // "(with ...)" is a featuring credit; a remix still isn't the song.
  assert.ok(recommendationMatch({ title: 'Song', artist: 'A' }, [{ title: 'Song (with B)', artist: 'A' }]))
  assert.equal(recommendationMatch({ title: 'Song', artist: 'A' }, [{ title: 'Song (with B) [Remix]', artist: 'A' }]), null)
})

test('a match from another release is saved with the cover that was shown', async () => {
  const { client, saved } = clientMock({
    onlineSearch: async () => ({ results: [{ id: '9', title: 'Boogie Wonderland', artist: 'Earth, Wind & Fire', album: 'Greatest Hits', thumbnail: 'https://addon.example/gh.jpg' }] }),
  })
  await resolveRecommendationTracks([{ title: 'Boogie Wonderland', artist: 'Earth, Wind & Fire', album: 'I Am', artwork_url: 'https://lastfm.example/i-am.jpg' }], client, { sources: [{ id: addon, label: 'Addon' }], prepareStreams: false })
  assert.equal(saved[0]?.thumbnail, 'https://lastfm.example/i-am.jpg')
})

test("moving a playback source keeps the ones not available right now in their place", async () => {
  const { movePlaybackSource } = await import('../src/playbackSources.js')
  const addon = { id: 'a-0123456789' }
  // The addon is first but not loaded yet (or being reinstalled): moving SoundCloud up keeps it first.
  assert.deepEqual(movePlaybackSource(JSON.stringify(['a-0123456789', 'yt', 'sc']), [{ id: 'yt' }, { id: 'sc' }], 1, -1), ['a-0123456789', 'sc', 'yt'])
  assert.deepEqual(orderedPlaybackSources(JSON.stringify(['a-0123456789', 'sc', 'yt']), [{ id: 'yt' }, { id: 'sc' }, addon]).map(p => p.id), ['a-0123456789', 'sc', 'yt'])
  // All available: an ordinary move; a new source starts last.
  assert.deepEqual(movePlaybackSource(JSON.stringify(['yt', 'sc']), [{ id: 'yt' }, { id: 'sc' }, addon], 2, -1), ['yt', 'a-0123456789', 'sc'])
  assert.deepEqual(movePlaybackSource('not json', [{ id: 'yt' }, { id: 'sc' }], 0, 1), ['sc', 'yt'])
  assert.deepEqual(movePlaybackSource(JSON.stringify(['yt', 'sc']), [{ id: 'yt' }, { id: 'sc' }], 1, 1), ['yt', 'sc'])
})

test('guests and Explicit labels: searched without them, matched either way (Estelle albums)', async () => {
  const { recommendationQueries: queries, recommendationMatch: match, mainArtist, searchTitle } = await import('../src/recommendations.js')
  assert.equal(mainArtist('Estelle [feat. Teedra Moses & Russell Taylor]'), 'Estelle')
  assert.equal(mainArtist('Estelle feat. Joi'), 'Estelle')
  assert.equal(searchTitle('Oh I [Explicit]'), 'Oh I')
  assert.equal(searchTitle('American Boy (feat. Kanye West)'), 'American Boy')
  assert.equal(searchTitle('Pretty Please (Love Me) [Feat. Cee-Lo]'), 'Pretty Please (Love Me)')
  assert.equal(searchTitle('Hold On (feat. X) [Remix]'), 'Hold On [Remix]')

  const grateful = { title: 'Grateful', artist: 'Estelle [feat. Teedra Moses & Russell Taylor]', album: 'Stay Alta', album_artist: 'Estelle' }
  assert.equal(queries(grateful)[0], 'Estelle Grateful')
  assert.ok(match(grateful, [{ title: 'Grateful', artist: 'Estelle', album: 'Stay Alta' }]))

  const ohI = { title: 'Oh I [Explicit]', artist: 'Estelle', album: 'Stay Alta' }
  assert.equal(queries(ohI)[0], 'Estelle Oh I')
  assert.ok(match(ohI, [{ title: 'Oh I', artist: 'Estelle' }]))

  const loveOnLove = { title: 'Love On Love', artist: 'Estelle, D-Nice, Estelle Swaray & Derrick Jones', album: 'Stay Alta', album_artist: 'Estelle' }
  assert.ok(queries(loveOnLove).includes('Estelle Love On Love'))
  assert.ok(match(loveOnLove, [{ title: 'Love On Love', artist: 'Estelle', artists: ['Estelle', 'D-Nice'] }]))

  const americanBoy = { title: 'American Boy (feat. Kanye West)', artist: 'Estelle', album: 'Shine' }
  assert.ok(match(americanBoy, [{ title: 'American Boy', artist: 'Estelle feat. Kanye West' }]))

  // Still another song, or another artist's, isn't taken.
  assert.equal(match(grateful, [{ title: 'Grateful', artist: 'Someone Else' }]), null)
  assert.equal(match(americanBoy, [{ title: 'American Boy (Remix)', artist: 'Estelle' }]), null)
})

test('imported addon ghosts match guest credits and original/single version labels', async () => {
  const candidates = [
    { title: 'Nasty Girl (feat. Diddy, Nelly, Jagged Edge)', artist: 'The Notorious B.I.G., Avery Storm, Diddy, Nelly, Jagged Edge' },
    { title: 'Luv2U - Original Mix', artist: 'FakeFunk' },
    { title: 'Never Enough - Single Version', artist: 'Boris Dlugosch, Róisín Murphy' },
    { title: 'All Mine [feat. Guest One & Guest Two]', artist: 'Lead Artist, Guest One, Guest Two' },
  ]
  assert.ok(recommendationMatch(candidates[0], [{ title: 'Nasty Girl', artist: 'The Notorious B.I.G.' }]))
  assert.ok(recommendationMatch(candidates[1], [{ title: 'Luv2U', artist: 'FakeFunk' }]))
  assert.ok(recommendationMatch(candidates[2], [{ title: 'Never Enough', artist: 'Boris Dlugosch, Róisín Murphy' }]))
  assert.ok(recommendationMatch(candidates[3], [{ title: 'All Mine', artist: 'Lead Artist' }]))
  assert.equal(recommendationMatch(candidates[2], [{ title: 'Never Enough - Club Mix', artist: 'Boris Dlugosch, Róisín Murphy' }]), null)
  assert.equal(recommendationQueries({ title: 'With You', artist: 'Lead Artist, Guest One, Guest Two' })[0], 'Lead Artist With You')
  const searches = []
  const { client } = clientMock({
    getSettings: async () => ({ playback_search_order: `['${addon}']` }),
    onlineProviders: async () => [{ id: addon }],
    onlineSearch: async (query, provider) => {
      searches.push([query, provider])
      const result = query.includes('Nasty Girl') ? { id: 'nasty', title: 'Nasty Girl', artist: 'The Notorious B.I.G.' }
        : query.includes('Luv2U') ? { id: 'luv2u', title: 'Luv2U', artist: 'FakeFunk' }
          : query.includes('All Mine') ? { id: 'all-mine', title: 'All Mine', artist: 'Lead Artist' }
            : { id: 'never', title: 'Never Enough', artist: 'Boris Dlugosch, Róisín Murphy' }
      return { results: [result] }
    },
  })
  const resolved = await resolveRecommendationTracks(candidates, client, { sources: [{ id: addon }], prepareStreams: false })
  assert.equal(resolved.length, 4)
  assert.ok(searches.some(([query]) => query === 'The Notorious B.I.G. Nasty Girl'))
  assert.ok(searches.some(([query]) => query === 'FakeFunk Luv2U'))
  assert.ok(searches.some(([query]) => query.includes('Never Enough')))
  assert.ok(searches.some(([query]) => query === 'Lead Artist All Mine'))
})


test('flattened CSV credits search the lead artist first and match provider credit variants', () => {
  for (const artist of ['2Pac, Outlawz', '2Pac;Outlawz', '2Pac, Outlawz, Guest']) {
    const candidate = { title: "Hit 'Em Up - Single Version", artist }
    assert.equal(recommendationQueries(candidate)[0], "2Pac Hit 'Em Up")
    for (const credit of ['2Pac', '2Pac, Outlawz', '2Pac feat. Outlawz']) {
      const result = { title: "Hit 'Em Up", artist: credit }
      assert.equal(recommendationMatch(candidate, [result]), result)
    }
    for (const result of [
      { title: "Hit 'Em Up", artist: 'Outlawz' },
      { title: "Hit 'Em Up", artist: '2Pac Tribute' },
      { title: "Hit 'Em Up (Live)", artist: '2Pac' },
      { title: "Hit 'Em Up (Remix)", artist: '2Pac' },
    ]) assert.equal(recommendationMatch(candidate, [result]), null)
  }
})

test('comma-containing artist names and structured credits are preserved', () => {
  for (const name of ['Earth, Wind & Fire', 'Tyler, The Creator', 'Crosby, Stills, Nash & Young', 'Emerson, Lake & Palmer']) {
    for (const artist of [name, name + ', Guest']) {
      const candidate = { title: 'Song', artist }
      assert.equal(recommendationQueries(candidate)[0], name + ' Song')
      assert.ok(recommendationMatch(candidate, [{ title: 'Song', artist: name }]))
      assert.equal(recommendationMatch(candidate, [{ title: 'Song', artist: name.split(',')[0] }]), null)
    }
  }
  const candidate = { title: 'Song', artist: 'Custom, Band, Guest', artists: ['Custom, Band', 'Guest'] }
  assert.equal(recommendationQueries(candidate)[0], 'Custom, Band Song')
  assert.equal(recommendationMatch(candidate, [{ title: 'Song', artist: 'Custom' }]), null)
})
