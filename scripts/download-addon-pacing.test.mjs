import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { DownloadManager } = require('../electron/download/manager.js')

function managerWith(jobs, concurrency = 6) {
  const mgr = new DownloadManager()
  mgr.settings = () => ({ download_concurrency: String(concurrency) })
  const started = []
  mgr.start = job => { job.status = 'downloading'; mgr.running++; started.push(job.id) }
  jobs.forEach((job, index) => mgr.jobs.set(job.id, { status: 'queued', createdAt: index, opts: {}, ...job }))
  return { mgr, started }
}
const addonJob = (id, provider = 'a-0123456789') => ({ id, kind: 'single', opts: { addonSource: { provider, id } } })

test('a batch goes to each addon one at a time a moment apart, at most two at once', async () => {
  const { mgr, started } = managerWith([addonJob('t1'), addonJob('t2'), addonJob('t3'), { id: 'yt', kind: 'single' }, addonJob('o1', 'a-abcdefabcd')])
  mgr.pump()
  // One per addon right away; plain downloads aren't held back.
  assert.deepEqual(started, ['t1', 'yt', 'o1'])
  await new Promise(resolve => setTimeout(resolve, 1600))
  assert.deepEqual(started, ['t1', 'yt', 'o1', 't2'])
  await new Promise(resolve => setTimeout(resolve, 1600))
  // Two from that addon are running: the third waits for one to finish.
  assert.deepEqual(started, ['t1', 'yt', 'o1', 't2'])
  mgr.jobs.get('t1').status = 'done'; mgr.running--
  mgr.pump()
  assert.deepEqual(started, ['t1', 'yt', 'o1', 't2', 't3'])
  clearTimeout(mgr.addonWake)
})
