import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const preview = require('../electron/online/videoPreview.js')

const HOME = '<script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"2.20261009.01.00","VISITOR_DATA":"CgtWaXNpdG9y"})</script>'
const renderer = (videoId, moving) => ({ videoRenderer: { videoId, ...(moving ? { richThumbnail: { movingThumbnailRenderer: { movingThumbnailDetails: { thumbnails: [{ url: `https://i.ytimg.com/an_webp/${videoId}/mqdefault_6s.webp?du=3000`, width: 320, height: 180 }] } } } } : {}) } })
const results = (...items) => ({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] } } } } })

function fakeYouTube(response) {
  const asked = []
  const fetchImpl = async (url, init = {}) => {
    asked.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} })
    if (String(url).startsWith('https://www.youtube.com/?')) return new Response(HOME)
    return new Response(JSON.stringify(typeof response === 'function' ? response() : response))
  }
  return { asked, fetchImpl }
}

test('finds the video\'s own animated preview in the search results, or none', () => {
  const response = results(renderer('aaaaaaaaaaa', true), renderer('bbbbbbbbbbb', false))
  assert.match(preview.movingThumbnail(response, 'aaaaaaaaaaa'), /^https:\/\/i\.ytimg\.com\/an_webp\/aaaaaaaaaaa\//)
  assert.equal(preview.movingThumbnail(response, 'bbbbbbbbbbb'), null, 'no animated preview: none (no slideshow)')
  assert.equal(preview.movingThumbnail(response, 'ccccccccccc'), null, 'not in the results')
})

test('asks as a current web client, remembers the answer, and asks again when told the link stopped working', async () => {
  preview.forget()
  const { asked, fetchImpl } = fakeYouTube(results(renderer('ZaI2IlHwmgQ', true)))
  const url = await preview.animatedPreview('ZaI2IlHwmgQ', 'The Black Eyed Peas - Pump It (Official Music Video)', { fetchImpl })
  assert.match(url, /an_webp\/ZaI2IlHwmgQ/)
  const search = asked.find(a => a.url.includes('/youtubei/v1/search'))
  assert.equal(search.body.context.client.clientVersion, '2.20261009.01.00')
  assert.equal(search.body.context.client.visitorData, 'CgtWaXNpdG9y')
  assert.equal(search.headers['x-goog-visitor-id'], 'CgtWaXNpdG9y')
  const before = asked.length
  assert.equal(await preview.animatedPreview('ZaI2IlHwmgQ', 'again', { fetchImpl }), url)
  assert.equal(asked.length, before, 'remembered')
  await preview.animatedPreview('ZaI2IlHwmgQ', 'again', { fetchImpl, force: true })
  assert.equal(asked.length, before + 1, 'asked again (the session is reused)')
})

test('one search at a time; bad ids and failures cost nothing and are not remembered', async () => {
  preview.forget()
  let running = 0
  let most = 0
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://www.youtube.com/?')) return new Response(HOME)
    running++; most = Math.max(most, running)
    await new Promise(resolve => setTimeout(resolve, 20))
    running--
    return new Response(JSON.stringify(results(renderer('aaaaaaaaaaa', true), renderer('bbbbbbbbbbb', true), renderer('ccccccccccc', true))))
  }
  const found = await Promise.all(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map(id => preview.animatedPreview(id, 'q', { fetchImpl })))
  assert.ok(found.every(Boolean))
  assert.equal(most, 1)
  assert.equal(await preview.animatedPreview('not a video id', 'q', { fetchImpl }), null)
  preview.forget()
  let calls = 0
  const offline = async () => { calls++; throw new Error('offline') }
  assert.equal(await preview.animatedPreview('aaaaaaaaaaa', 'q', { fetchImpl: offline }), null)
  assert.equal(await preview.animatedPreview('aaaaaaaaaaa', 'q', { fetchImpl: offline }), null)
  assert.equal(calls, 2, 'a failure is not remembered as "none"')
})

test('the music video lookup\'s youtube.com search: id, title, channel and length of each video', async () => {
  preview.forget()
  const video = { videoRenderer: { videoId: 'kffacxfA7G4', title: { runs: [{ text: 'Justin Bieber - Baby ' }, { text: '(Official Music Video)' }] }, ownerText: { runs: [{ text: 'JustinBieberVEVO' }] }, lengthText: { simpleText: '3:45' } } }
  const long = { videoRenderer: { videoId: 'aaaaaaaaaaa', title: { simpleText: 'Live set' }, longBylineText: { runs: [{ text: 'Channel' }] }, lengthText: { simpleText: '1:02:03' } } }
  const { asked, fetchImpl } = fakeYouTube(results(video, long, { videoRenderer: { videoId: 'bad' } }))
  const found = await preview.searchVideos('justin bieber baby official music video', { fetchImpl })
  assert.deepEqual(found, [
    { id: 'kffacxfA7G4', title: 'Justin Bieber - Baby (Official Music Video)', channel: 'JustinBieberVEVO', duration: 225, url: 'https://www.youtube.com/watch?v=kffacxfA7G4' },
    { id: 'aaaaaaaaaaa', title: 'Live set', channel: 'Channel', duration: 3723, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
  ])
  assert.equal(asked.at(-1).body.query, 'justin bieber baby official music video')
  assert.equal(asked.at(-1).body.context.client.clientName, 'WEB')
  assert.deepEqual(await preview.searchVideos('   ', { fetchImpl }), [])
})
