import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

// Exercise each production grouping implementation without loading Electron or
// a native database. Quality ranking is independent of the candidate filter.
for (const [name, file, end] of [
  ['desktop', 'electron/ipc/scanner.js', 'function applyBatchField'],
  ['server', 'server/routes/tracks.js', 'function getKeepCommaArtists'],
]) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const functions = source.slice(source.indexOf('function normalizeDuplicateText'), source.indexOf(end))
  const group = vm.runInNewContext(`${functions}; buildPossibleDuplicateGroups`, { scoreTrack: track => track.bitrate || 0 })
  const local = (id, title = 'Plastic Love', bitrate = 128) => ({ id, title, artist: 'Mariya Takeuchi', duration: 296, bitrate, file_path: `/Music/${id}.flac` })
  const ghost = { ...local('ghost', 'Plastic Love Original', 999), file_path: 'ghost://spotify/streamed-once' }

  test(`${name}: a file and its ghost are not similar duplicates`, () => {
    assert.equal(group([local('song'), ghost]).length, 0)
    assert.equal(group([ghost, { ...ghost, id: 'ghost2', title: 'Plastic Love' }]).length, 0)
  })

  test(`${name}: actual file pairs remain, with dense indices after exclusions`, () => {
    const input = [ghost, local('one'), local('invalid', ''), { ...ghost, file_path: 'GHOST://old' }, local('two', 'Plastic Love Original', 320)]
    const result = group(input)
    assert.equal(result.length, 1)
    assert.deepEqual(Array.from(result[0].tracks, track => track.id), ['two', 'one'])
    assert.equal(result[0].suggestedKeepId, 'two')
    assert.equal(input.length, 5)
    assert.equal(input[0], ghost, 'filtering never deletes ghost/history records')
  })
}
