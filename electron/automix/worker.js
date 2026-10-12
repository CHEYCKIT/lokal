// Song analysis off the main thread: PCM in (transferred), analysis out.
const { parentPort } = require('worker_threads')
const { analyze } = require('./analysis')

parentPort.on('message', ({ id, pcm, rate }) => {
  try {
    parentPort.postMessage({ id, result: analyze(new Float32Array(pcm), rate) })
  } catch (error) {
    parentPort.postMessage({ id, error: error.message })
  }
})
