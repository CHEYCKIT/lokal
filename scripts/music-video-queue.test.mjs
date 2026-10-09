import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { DownloadManager } = require('../electron/download/manager.js')
const url = 'https://www.youtube.com/watch?v=4NRXx6U8ABQ'
const options = { videoId: '4NRXx6U8ABQ', title: 'Blinding Lights', cacheDir: '/cache', videoHeight: 1080 }

function manager(deps = {}) {
  const mgr = new DownloadManager().configure({ findTools: () => ({ ytdlp: '/fixture/yt-dlp' }), ...deps })
  mgr.initialized = true
  mgr.persist = () => {}
  return mgr
}

test('video cache jobs share the real queue, deduplicate, and finish without audio library indexing', async () => {
  let complete
  let progress
  const snapshots = []
  let indexed = false
  const mgr = manager({
    emit: value => snapshots.push(value),
    index: () => { indexed = true },
    downloadMusicVideo: async (_, opts) => {
      progress = opts.onProgress
      return new Promise(resolve => { complete = resolve })
    },
  })
  const first = mgr.enqueue('music-video', url, options)
  const again = mgr.enqueue('music-video', url, options)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(again.downloadId, first.downloadId)
  assert.equal(mgr.list()[0].kind, 'music-video')
  assert.equal(mgr.list()[0].status, 'downloading')
  progress({ percent: 42 })
  assert.equal(mgr.list()[0].progress, 42)
  complete('/cache/4NRXx6U8ABQ-1080.mp4')
  const job = await mgr.waitFor(first.downloadId)
  assert.equal(job.status, 'done')
  assert.equal(job.song, '/cache/4NRXx6U8ABQ-1080.mp4')
  assert.equal(indexed, false)
  assert.ok(snapshots.some(s => s.status === 'done'))
})

test('video jobs respect download concurrency and can be cancelled from Downloads', async () => {
  const mgr = manager({ downloadMusicVideo: (_, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
  }) })
  mgr.concurrency = () => 1
  const first = mgr.enqueue('music-video', url, options)
  const second = mgr.enqueue('music-video', url.replace('4NRXx6U8ABQ', 'IKqV7DB8Iwg'), { ...options, videoId: 'IKqV7DB8Iwg' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(mgr.jobs.get(second.downloadId).status, 'queued')
  await mgr.cancel(first.downloadId)
  assert.equal((await mgr.waitFor(first.downloadId)).status, 'cancelled')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(mgr.jobs.get(second.downloadId).status, 'downloading')
  await mgr.cancel(second.downloadId)
  await mgr.waitFor(second.downloadId)
})
